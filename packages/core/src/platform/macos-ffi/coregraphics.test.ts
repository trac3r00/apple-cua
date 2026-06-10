import { beforeEach, describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const sourceReference = { type: "source" };
	const keyboardEvent = { type: "keyboard" };
	const mouseEvent = { type: "mouse" };
	const cursorEvent = { type: "cursor" };

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
		CGEventCreate: vi.fn(() => cursorEvent),
		CGEventCreateMouseEvent: vi.fn(() => mouseEvent),
		CGEventCreateKeyboardEvent: vi.fn(() => keyboardEvent),
		CGEventCreateScrollWheelEvent: vi.fn(() => ({ type: "scroll" })),
		CGEventKeyboardSetUnicodeString: vi.fn(),
		CGEventSetFlags: vi.fn(),
		CGEventSetIntegerValueField: vi.fn(),
		CGEventSetTimestamp: vi.fn(),
		CGEventSetLocation: vi.fn(),
		CGEventGetLocation: vi.fn(() => ({ x: 10.4, y: 20.6 })),
		CGEventPost: vi.fn(),
		CGEventPostToPid: vi.fn(),
		CGWarpMouseCursorPosition: vi.fn(() => 0),
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
		mouseEvent,
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
	createNSEventBackedMouseEvent: vi.fn(() => koffiMock.mouseEvent),
}));
vi.mock("./skylight.js", () => ({
	postCoreGraphicsEventToWindowOwner: skyLightMock.postCoreGraphicsEventToWindowOwner,
	postAuthenticatedSkyLightEventToPid: skyLightMock.postAuthenticatedSkyLightEventToPid,
	postSkyLightEventToPid: skyLightMock.postSkyLightEventToPid,
	setSkyLightIntegerField: skyLightMock.setSkyLightIntegerField,
	setSkyLightWindowLocation: skyLightMock.setSkyLightWindowLocation,
}));

describe("#given CoreGraphics koffi bindings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("#when posting keyboard events to a pid without a known window", () => {
		it("#then refuses to fall back to the public pid post", async () => {
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
			expect(koffiMock.coreGraphicsFunctions.CGEventSetTimestamp).toHaveBeenCalledWith(
				koffiMock.keyboardEvent,
				123n,
			);
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
	});

	describe("#when posting keyboard events to a known target window", () => {
		it("#then uses SkyLight authenticated delivery", async () => {
			const { K_CG_EVENT_FLAG_MASK_COMMAND, postKeyboardEvent } = await import("./coregraphics.js");

			postKeyboardEvent({
				keyCode: 37,
				keyDown: true,
				flags: K_CG_EVENT_FLAG_MASK_COMMAND,
				text: undefined,
				targetPid: 4321,
				targetWindow: { id: 99, bounds: { x: 80, y: 170, width: 400, height: 300 } },
			});

			expect(skyLightMock.postAuthenticatedSkyLightEventToPid).toHaveBeenCalledWith(4321, koffiMock.keyboardEvent);
			expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).not.toHaveBeenCalled();
			expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.keyboardEvent);
		});
	});

	describe("#when posting mouse events without a target pid", () => {
		it("#then posts through the global HID event tap", async () => {
			const { postMouseEvent } = await import("./coregraphics.js");

			postMouseEvent({
				kind: "down",
				position: { x: 100, y: 200 },
				button: "right",
				clickState: 1,
				targetPid: undefined,
			});

			expect(koffiMock.coreGraphicsFunctions.CGEventCreateMouseEvent).toHaveBeenCalledWith(
				koffiMock.sourceReference,
				3,
				{ x: 100, y: 200 },
				1,
			);
			expect(koffiMock.coreGraphicsFunctions.CGEventSetIntegerValueField).toHaveBeenCalledWith(
				koffiMock.mouseEvent,
				1,
				1,
			);
			expect(koffiMock.coreGraphicsFunctions.CGEventPost).toHaveBeenCalledWith(0, koffiMock.mouseEvent);
		});
	});

	describe("#when posting mouse events to a known target window", () => {
		it("#then stamps SkyLight window metadata and avoids the public pid post", async () => {
			const { postMouseEvent } = await import("./coregraphics.js");

			postMouseEvent({
				kind: "down",
				position: { x: 100, y: 200 },
				button: "left",
				clickState: 1,
				targetPid: 4321,
				targetWindow: { id: 99, bounds: { x: 80, y: 170, width: 400, height: 300 } },
			});

			expect(skyLightMock.setSkyLightWindowLocation).toHaveBeenCalledWith(koffiMock.mouseEvent, { x: 20, y: 30 });
			expect(skyLightMock.setSkyLightIntegerField).toHaveBeenCalledWith(koffiMock.mouseEvent, 40, 4321);
			expect(skyLightMock.postSkyLightEventToPid).toHaveBeenCalledWith(4321, koffiMock.mouseEvent);
			expect(skyLightMock.postCoreGraphicsEventToWindowOwner).toHaveBeenCalledWith(
				{ id: 99, bounds: { x: 80, y: 170, width: 400, height: 300 } },
				koffiMock.mouseEvent,
			);
			expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).not.toHaveBeenCalled();
		});
	});

	describe("#when posting a targeted mouse event #then the real cursor is saved and restored", () => {
		it("warps the cursor back to its pre-post position for targeted events", async () => {
			const { postMouseEvent } = await import("./coregraphics.js");

			postMouseEvent({
				kind: "down",
				position: { x: 100, y: 200 },
				button: "left",
				clickState: 1,
				targetPid: 4321,
				targetWindow: { id: 99, bounds: { x: 80, y: 170, width: 400, height: 300 } },
			});

			expect(koffiMock.coreGraphicsFunctions.CGWarpMouseCursorPosition).toHaveBeenCalledWith({ x: 10.4, y: 20.6 });
		});

		it("does not warp the cursor for untargeted events", async () => {
			const { postMouseEvent } = await import("./coregraphics.js");

			postMouseEvent({ kind: "down", position: { x: 100, y: 200 }, button: "left", clickState: 1, targetPid: undefined });

			expect(koffiMock.coreGraphicsFunctions.CGWarpMouseCursorPosition).not.toHaveBeenCalled();
		});
	});

	describe("#when posting mouse events to a pid without a known window", () => {
		it("#then refuses to fall back to the public pid post", async () => {
			const { postMouseEvent } = await import("./coregraphics.js");

			expect(() =>
				postMouseEvent({
					kind: "down",
					position: { x: 100, y: 200 },
					button: "left",
					clickState: 1,
					targetPid: 4321,
				}),
			).toThrow("targeted mouse input requires a target window");

			expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).not.toHaveBeenCalled();
			expect(skyLightMock.postSkyLightEventToPid).not.toHaveBeenCalled();
		});
	});

	describe("#when posting scroll events to a pid without a known window", () => {
		it("#then refuses to fall back to the public pid post", async () => {
			const { postScrollEvent } = await import("./coregraphics.js");

			expect(() => postScrollEvent({ deltaX: 0, deltaY: -2, targetPid: 4321 })).toThrow(
				"targeted scroll input requires a target window",
			);

			expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).not.toHaveBeenCalled();
			expect(skyLightMock.postSkyLightEventToPid).not.toHaveBeenCalled();
		});
	});

	describe("#when reading the cursor position", () => {
		it("#then returns the location from a temporary CGEvent", async () => {
			const { getCurrentCursorPosition } = await import("./coregraphics.js");

			const position = getCurrentCursorPosition();

			expect(position).toEqual({ x: 10.4, y: 20.6 });
		});
	});
});
