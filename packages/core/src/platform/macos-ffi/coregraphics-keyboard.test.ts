import { beforeEach, describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const sourceReference = { type: "source" };
	const keyboardEvent = { type: "keyboard" };
	const coreFoundationFunctions = {
		CFGetTypeID: vi.fn(),
		CFRetain: vi.fn(),
		CFStringCreateWithCString: vi.fn(),
		CFStringGetLength: vi.fn(),
		CFStringGetMaximumSizeForEncoding: vi.fn(),
		CFStringGetCString: vi.fn(),
		CFArrayCreate: vi.fn(),
		CFArrayGetCount: vi.fn(),
		CFArrayGetValueAtIndex: vi.fn(),
		CFStringGetTypeID: vi.fn(),
		CFNumberGetTypeID: vi.fn(),
		CFNumberGetValue: vi.fn(),
		CFBooleanGetTypeID: vi.fn(),
		CFBooleanGetValue: vi.fn(),
		CFRelease: vi.fn(),
	};
	const coreGraphicsFunctions = {
		CGEventSourceCreate: vi.fn(() => sourceReference),
		CGEventCreate: vi.fn(),
		CGEventCreateMouseEvent: vi.fn(),
		CGEventCreateKeyboardEvent: vi.fn(() => keyboardEvent),
		CGEventCreateScrollWheelEvent: vi.fn(),
		CGEventKeyboardSetUnicodeString: vi.fn(),
		CGEventSetFlags: vi.fn(),
		CGEventSetIntegerValueField: vi.fn(),
		CGEventSetTimestamp: vi.fn(),
		CGEventSetLocation: vi.fn(),
		CGEventGetLocation: vi.fn(),
		CGEventPost: vi.fn(),
		CGEventPostToPid: vi.fn(),
		CGWarpMouseCursorPosition: vi.fn(),
	};
	const systemFunctions = {
		clock_gettime_nsec_np: vi.fn(() => 123n),
	};

	function libraryFor(path: string | null) {
		if (path === "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics") {
			return coreGraphicsFunctions;
		}
		if (path === "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation") {
			return coreFoundationFunctions;
		}
		if (path === null) {
			return systemFunctions;
		}
		throw new Error(`Unexpected library: ${String(path)}`);
	}

	return {
		coreFoundationFunctions,
		coreGraphicsFunctions,
		keyboardEvent,
		sourceReference,
		module: {
			load: vi.fn((path: string | null) => ({
				func: vi.fn((name: string | number) => {
					const nativeFunctions = libraryFor(path);
					const nativeFunction = nativeFunctions[String(name) as keyof typeof nativeFunctions];
					if (nativeFunction === undefined) {
						throw new Error(`Unexpected native function: ${String(name)}`);
					}
					return nativeFunction;
				}),
			})),
			opaque: vi.fn(() => ({ type: "opaque" })),
			pointer: vi.fn((name: unknown) => ({ type: "pointer", name })),
			struct: vi.fn((_name: string, members: object) => ({ type: "struct", members })),
		},
	};
});

const skyLightMock = vi.hoisted(() => ({
	postCoreGraphicsEventToWindowOwner: vi.fn(),
	postAuthenticatedSkyLightEventToPid: vi.fn(() => true),
	postSkyLightEventToPid: vi.fn(),
	setSkyLightIntegerField: vi.fn(),
	setSkyLightWindowLocation: vi.fn(),
}));

vi.mock("koffi", () => koffiMock.module);
vi.mock("./appkit.js", () => ({
	createNSEventBackedMouseEvent: vi.fn(),
}));
vi.mock("./skylight.js", () => ({
	postCoreGraphicsEventToWindowOwner: skyLightMock.postCoreGraphicsEventToWindowOwner,
	postAuthenticatedSkyLightEventToPid: skyLightMock.postAuthenticatedSkyLightEventToPid,
	postSkyLightEventToPid: skyLightMock.postSkyLightEventToPid,
	setSkyLightIntegerField: skyLightMock.setSkyLightIntegerField,
	setSkyLightWindowLocation: skyLightMock.setSkyLightWindowLocation,
}));

describe("#given CoreGraphics keyboard event routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("#when posting keyboard events to a pid without a known window #then refuses public pid fallback", async () => {
		const { K_CG_EVENT_FLAG_MASK_COMMAND, postKeyboardEvent } = await import("./coregraphics.js");

		expect(() =>
			postKeyboardEvent({
				keyCode: 37,
				keyDown: true,
				flags: K_CG_EVENT_FLAG_MASK_COMMAND,
				text: undefined,
				targetPid: 4321,
			}),
		).toThrow("targeted keyboard input requires a target window");

		expect(koffiMock.coreGraphicsFunctions.CGEventSourceCreate).toHaveBeenCalledWith(1);
		expect(koffiMock.coreGraphicsFunctions.CGEventCreateKeyboardEvent).toHaveBeenCalledWith(
			koffiMock.sourceReference,
			37,
			true,
		);
		expect(koffiMock.coreGraphicsFunctions.CGEventSetTimestamp).toHaveBeenCalledWith(koffiMock.keyboardEvent, 123n);
		expect(koffiMock.coreGraphicsFunctions.CGEventSetFlags).toHaveBeenCalledWith(
			koffiMock.keyboardEvent,
			K_CG_EVENT_FLAG_MASK_COMMAND,
		);
		expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).not.toHaveBeenCalled();
		expect(skyLightMock.postAuthenticatedSkyLightEventToPid).not.toHaveBeenCalled();
		expect(skyLightMock.postSkyLightEventToPid).not.toHaveBeenCalled();
		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.sourceReference);
		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.keyboardEvent);
	});

	it("#when posting keyboard events to a known target window #then uses authenticated and owner delivery", async () => {
		const { K_CG_EVENT_FLAG_MASK_COMMAND, postKeyboardEvent } = await import("./coregraphics.js");
		const targetWindow = { id: 99, bounds: { x: 80, y: 170, width: 400, height: 300 } };

		postKeyboardEvent({
			keyCode: 37,
			keyDown: true,
			flags: K_CG_EVENT_FLAG_MASK_COMMAND,
			text: undefined,
			targetPid: 4321,
			targetWindow,
		});

		expect(skyLightMock.postAuthenticatedSkyLightEventToPid).toHaveBeenCalledWith(4321, koffiMock.keyboardEvent);
		expect(skyLightMock.postCoreGraphicsEventToWindowOwner).toHaveBeenCalledWith(
			targetWindow,
			koffiMock.keyboardEvent,
		);
		expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).not.toHaveBeenCalled();
		expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.keyboardEvent);
	});
});
