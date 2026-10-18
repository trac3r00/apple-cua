import { beforeEach, describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const state = { classPresent: true };
	const authenticationClass = { type: "SLSEventAuthenticationMessage" };
	const objcFunctions = {
		objc_getClass: vi.fn(() => (state.classPresent ? authenticationClass : null)),
		sel_registerName: vi.fn((name: string) => ({ type: "selector", name })),
		objc_msgSend: vi.fn(() => ({ type: "authentication-message" })),
	};
	const skyLightFunctions = {
		SLEventSetAuthenticationMessage: vi.fn(),
		SLEventPostToPid: vi.fn(),
		SLSGetWindowOwner: vi.fn(() => 0),
		SLSGetConnectionPSN: vi.fn(() => 0),
		SLPSPostEventRecordTo: vi.fn(() => 0),
		SLPSSetFrontProcessWithOptions: vi.fn(),
	};

	function library(functions: Readonly<Record<string, unknown>>) {
		return { func: vi.fn((name: string) => functions[name] ?? vi.fn()) };
	}

	return {
		state,
		authenticationClass,
		objcFunctions,
		skyLightFunctions,
		module: {
			load: vi.fn((path: string) => {
				if (path.endsWith("libobjc.A.dylib")) {
					return library(objcFunctions);
				}
				return library(path.endsWith("/SkyLight") ? skyLightFunctions : {});
			}),
			struct: vi.fn((name: string) => ({ type: "struct", name })),
			pointer: vi.fn((name: unknown) => ({ type: "pointer", name })),
			opaque: vi.fn(() => ({ type: "opaque" })),
			decode: vi.fn<(_pointer: object, offset: number, type: string) => object | number | null>(
				(_pointer, offset, type) => {
					if (type === "uint32_t") return offset === 4 ? 0xf8 : 11;
					return { type: "event-record" };
				},
			),
		},
	};
});

vi.mock("koffi", () => koffiMock.module);

const keyEvent = { type: "cg-event" };

async function loadSkyLight(classPresent: boolean) {
	koffiMock.state.classPresent = classPresent;
	vi.resetModules();
	return await import("./skylight.js");
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("#given SkyLight's authentication message class #when an authenticated event is posted #then the message is attached and the event delivered", () => {
	it("builds the message for the pid and posts the event to it", async () => {
		const skyLight = await loadSkyLight(true);

		const posted = skyLight.postAuthenticatedSkyLightEventToPid(321, keyEvent);

		expect(posted).toBe(true);
		expect(koffiMock.objcFunctions.objc_msgSend).toHaveBeenCalledWith(
			koffiMock.authenticationClass,
			expect.objectContaining({ name: "messageWithEventRecord:pid:version:" }),
			{ type: "event-record" },
			321,
			0,
		);
		expect(koffiMock.skyLightFunctions.SLEventSetAuthenticationMessage).toHaveBeenCalledWith(keyEvent, {
			type: "authentication-message",
		});
		expect(koffiMock.skyLightFunctions.SLEventPostToPid).toHaveBeenCalledWith(321, keyEvent);
	});
});

describe("#given a SkyLight without the authentication message class #when an authenticated event is posted #then it reports unavailable so the caller takes its CoreGraphics path", () => {
	it("sends no message and posts nothing", async () => {
		const skyLight = await loadSkyLight(false);

		const posted = skyLight.postAuthenticatedSkyLightEventToPid(321, keyEvent);

		expect(posted).toBe(false);
		expect(koffiMock.objcFunctions.objc_msgSend).not.toHaveBeenCalled();
		expect(koffiMock.skyLightFunctions.SLEventPostToPid).not.toHaveBeenCalled();
	});
});

describe("#given a window-stamped event #when its record is posted in background #then no foreground activation occurs", () => {
	const window = { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, layer: 21 };

	it("queues exactly one record to the window owner", async () => {
		const skyLight = await loadSkyLight(true);
		expect(skyLight.postBackgroundEventRecordToWindowOwner(window, keyEvent)).toBe(true);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).toHaveBeenCalledTimes(1);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).toHaveBeenCalledWith(Buffer.alloc(8), {
			type: "event-record",
		});
		expect(koffiMock.skyLightFunctions.SLPSSetFrontProcessWithOptions).not.toHaveBeenCalled();
		expect(koffiMock.skyLightFunctions.SLEventPostToPid).not.toHaveBeenCalled();
	});

	it("does not post if ownership cannot be resolved", async () => {
		const skyLight = await loadSkyLight(true);
		koffiMock.skyLightFunctions.SLSGetWindowOwner.mockReturnValueOnce(1);
		expect(skyLight.postBackgroundEventRecordToWindowOwner(window, keyEvent)).toBe(false);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).not.toHaveBeenCalled();
		expect(koffiMock.skyLightFunctions.SLPSSetFrontProcessWithOptions).not.toHaveBeenCalled();
	});

	it("does not post if there is no event record", async () => {
		const skyLight = await loadSkyLight(true);
		koffiMock.module.decode.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValueOnce(null);
		expect(skyLight.postBackgroundEventRecordToWindowOwner(window, keyEvent)).toBe(false);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).not.toHaveBeenCalled();
	});

	it("rejects an incompatible record header before dispatch", async () => {
		const skyLight = await loadSkyLight(true);
		koffiMock.module.decode.mockReturnValueOnce({ type: "event-record" }).mockReturnValueOnce(0);
		expect(skyLight.postBackgroundEventRecordToWindowOwner(window, keyEvent)).toBe(false);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).not.toHaveBeenCalled();
	});

	it("rejects a record stamped for another window", async () => {
		const skyLight = await loadSkyLight(true);
		koffiMock.module.decode
			.mockReturnValueOnce({ type: "event-record" })
			.mockReturnValueOnce(0xf8)
			.mockReturnValueOnce(99);
		expect(skyLight.postBackgroundEventRecordToWindowOwner(window, keyEvent)).toBe(false);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).not.toHaveBeenCalled();
	});

	it("reports a rejected record without a fallback or second post", async () => {
		const skyLight = await loadSkyLight(true);
		koffiMock.skyLightFunctions.SLPSPostEventRecordTo.mockReturnValueOnce(-50);
		expect(skyLight.postBackgroundEventRecordToWindowOwner(window, keyEvent)).toBe(false);
		expect(koffiMock.skyLightFunctions.SLPSPostEventRecordTo).toHaveBeenCalledTimes(1);
		expect(koffiMock.skyLightFunctions.SLPSSetFrontProcessWithOptions).not.toHaveBeenCalled();
		expect(koffiMock.skyLightFunctions.SLEventPostToPid).not.toHaveBeenCalled();
	});
});
