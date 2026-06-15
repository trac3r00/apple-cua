import { beforeEach, describe, expect, it, vi } from "vitest";

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 1, y: 2 })),
	postKeyboardEvent: vi.fn(),
	postMouseEvent: vi.fn(),
	postScrollEvent: vi.fn(),
	postUnicodeText: vi.fn(),
	warpCursorPosition: vi.fn(),
}));

vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
vi.mock("./macos-ffi/coregraphics.js", () => ({
	K_CG_EVENT_FLAG_MASK_ALTERNATE: 0x00080000,
	K_CG_EVENT_FLAG_MASK_COMMAND: 0x00100000,
	K_CG_EVENT_FLAG_MASK_CONTROL: 0x00040000,
	K_CG_EVENT_FLAG_MASK_SHIFT: 0x00020000,
	getCurrentCursorPosition: coreGraphicsMock.getCurrentCursorPosition,
	postKeyboardEvent: coreGraphicsMock.postKeyboardEvent,
	postMouseEvent: coreGraphicsMock.postMouseEvent,
	postScrollEvent: coreGraphicsMock.postScrollEvent,
	postUnicodeText: coreGraphicsMock.postUnicodeText,
	warpCursorPosition: coreGraphicsMock.warpCursorPosition,
}));

describe("#given MacOSInputController keyboard input", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("#when pressing a key with hold milliseconds #then releases after the hold duration", async () => {
		// given
		vi.useFakeTimers();
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController();

		// when
		const pressing = controller.pressKey("t", { holdMilliseconds: 250 });
		await vi.advanceTimersByTimeAsync(249);

		// then
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenCalledTimes(1);
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(1, {
			keyCode: 17,
			keyDown: true,
			flags: 0,
			text: undefined,
			targetPid: undefined,
			targetWindow: undefined,
		});

		await vi.advanceTimersByTimeAsync(1);
		await pressing;

		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(2, {
			keyCode: 17,
			keyDown: false,
			flags: 0,
			text: undefined,
			targetPid: undefined,
			targetWindow: undefined,
		});
		expect(vi.getTimerCount()).toBe(0);
		controller.close();
		vi.useRealTimers();
	});
});
