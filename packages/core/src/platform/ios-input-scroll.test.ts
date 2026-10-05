import { beforeEach, describe, expect, it, vi } from "vitest";

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 11, y: 22 })),
	postKeyboardEvent: vi.fn(),
	postMouseEvent: vi.fn(),
	postScrollEvent: vi.fn(),
	warpCursorPosition: vi.fn(),
}));

vi.mock("./macos-ffi/coregraphics.js", () => ({
	K_CG_EVENT_FLAG_MASK_ALTERNATE: 0x00080000,
	K_CG_EVENT_FLAG_MASK_COMMAND: 0x00100000,
	K_CG_EVENT_FLAG_MASK_CONTROL: 0x00040000,
	K_CG_EVENT_FLAG_MASK_SHIFT: 0x00020000,
	getCurrentCursorPosition: coreGraphicsMock.getCurrentCursorPosition,
	postKeyboardEvent: coreGraphicsMock.postKeyboardEvent,
	postMouseEvent: coreGraphicsMock.postMouseEvent,
	postScrollEvent: coreGraphicsMock.postScrollEvent,
	warpCursorPosition: coreGraphicsMock.warpCursorPosition,
}));
vi.mock("./macos-ffi/skylight.js", () => ({
	CGS_EVENT_LEFT_MOUSE_DOWN: 1,
	CGS_EVENT_LEFT_MOUSE_DRAGGED: 2,
	CGS_EVENT_LEFT_MOUSE_UP: 3,
	beginFocusWithoutRaise: vi.fn(() => null),
	postMouseEventRecordToWindow: vi.fn(() => true),
	restoreFrontProcessNoWindows: vi.fn(() => true),
}));
vi.mock("./macos-ffi/pasteboard.js", () => ({ readClipboard: vi.fn(), writeClipboard: vi.fn() }));

const bounds = { x: 0, y: 0, width: 400, height: 800 };
const at = { x: 200, y: 400 };

describe("#given phone scroll under background delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("#when the caller does not opt in #then it refuses before the real pointer is touched", async () => {
		// given
		const { scrollMirroring } = await import("./ios-input.js");
		const target = { pid: 1, windowId: 2, bounds, delivery: "background" } as const;

		// when
		const scroll = scrollMirroring(target, { at, deltaY: 100, steps: 1 });

		// then
		await expect(scroll).rejects.toThrow(/borrow the person's pointer/);
		expect(coreGraphicsMock.warpCursorPosition).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postScrollEvent).not.toHaveBeenCalled();
	});

	it("#when the caller opts in #then the pointer is warped onto the phone and put back", async () => {
		// given
		const { scrollMirroring } = await import("./ios-input.js");
		const target = { pid: 1, windowId: 2, bounds, delivery: "background" } as const;

		// when
		await scrollMirroring(target, { at, deltaY: 100, steps: 1, borrowPointer: true });

		// then
		expect(coreGraphicsMock.warpCursorPosition.mock.calls).toEqual([[at], [{ x: 11, y: 22 }]]);
		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledTimes(1);
	});
});

describe("#given phone scroll under attended delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("#when no opt-in is given #then it still scrolls, borrowing the pointer as before", async () => {
		// given
		const { scrollMirroring } = await import("./ios-input.js");
		const target = { pid: 1, windowId: 2, bounds, delivery: "attended" } as const;

		// when
		await scrollMirroring(target, { at, deltaY: 100, steps: 1 });

		// then
		expect(coreGraphicsMock.warpCursorPosition.mock.calls).toEqual([[at], [{ x: 11, y: 22 }]]);
		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledTimes(1);
	});
});
