import { describe, expect, it, vi } from "vitest";

const koffiMock = vi.hoisted(() => {
	const sourceReference = { type: "source" };
	const keyboardEvent = { type: "keyboard" };
	const mouseEvent = { type: "mouse" };
	const cursorEvent = { type: "cursor" };

	const coreFoundationFunctions = {
		CFStringCreateWithCString: vi.fn(),
		CFStringGetLength: vi.fn(),
		CFStringGetMaximumSizeForEncoding: vi.fn(),
		CFStringGetCString: vi.fn(),
		CFArrayCreate: vi.fn(),
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
		CGEventGetLocation: vi.fn(() => ({ x: 10.4, y: 20.6 })),
		CGEventPost: vi.fn(),
		CGEventPostToPid: vi.fn(),
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

vi.mock("koffi", () => koffiMock.module);

describe("#given CoreGraphics koffi bindings", () => {
	describe("#when posting keyboard events to a pid", () => {
		it("#then creates HID-sourced timestamped events and releases CFRefs", async () => {
			const { K_CG_EVENT_FLAG_MASK_COMMAND, postKeyboardEvent } = await import("./coregraphics.js");

			postKeyboardEvent({
				keyCode: 37,
				keyDown: true,
				flags: K_CG_EVENT_FLAG_MASK_COMMAND,
				text: undefined,
				targetPid: 4321,
			});

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
			expect(koffiMock.coreGraphicsFunctions.CGEventPostToPid).toHaveBeenCalledWith(4321, koffiMock.keyboardEvent);
			expect(koffiMock.coreFoundationFunctions.CFRelease).toHaveBeenCalledWith(koffiMock.sourceReference);
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

	describe("#when reading the cursor position", () => {
		it("#then returns the location from a temporary CGEvent", async () => {
			const { getCurrentCursorPosition } = await import("./coregraphics.js");

			const position = getCurrentCursorPosition();

			expect(position).toEqual({ x: 10.4, y: 20.6 });
		});
	});
});
