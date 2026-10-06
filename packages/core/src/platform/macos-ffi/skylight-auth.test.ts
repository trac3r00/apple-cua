import { beforeEach, describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const state = { selectorImplemented: false };
	const authenticationClass = { type: "SLSEventAuthenticationMessage" };
	const objcFunctions = {
		objc_getClass: vi.fn(() => authenticationClass),
		sel_registerName: vi.fn((name: string) => ({ type: "selector", name })),
		class_getClassMethod: vi.fn(() => (state.selectorImplemented ? { type: "method" } : null)),
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

async function loadSkyLight(selectorImplemented: boolean) {
	koffiMock.state.selectorImplemented = selectorImplemented;
	vi.resetModules();
	return await import("./skylight.js");
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("#given macOS 14, whose SLSEventAuthenticationMessage lacks messageWithEventRecord:pid:version: #when an authenticated event is posted #then it reports unavailable instead of crashing", () => {
	it("never sends the missing selector and posts nothing, so the caller takes its CoreGraphics path", async () => {
		const skyLight = await loadSkyLight(false);

		const posted = skyLight.postAuthenticatedSkyLightEventToPid(321, keyEvent);

		expect(posted).toBe(false);
		expect(koffiMock.objcFunctions.class_getClassMethod).toHaveBeenCalledWith(
			koffiMock.authenticationClass,
			expect.objectContaining({ name: "messageWithEventRecord:pid:version:" }),
		);
		expect(koffiMock.objcFunctions.objc_msgSend).not.toHaveBeenCalled();
		expect(koffiMock.skyLightFunctions.SLEventPostToPid).not.toHaveBeenCalled();
	});
});

describe("#given macOS 15 or later, where the selector exists #when an authenticated event is posted #then the message is attached and the event delivered", () => {
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
