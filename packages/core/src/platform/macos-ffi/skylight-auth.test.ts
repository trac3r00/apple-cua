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
			decode: vi.fn(() => ({ type: "event-record" })),
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
