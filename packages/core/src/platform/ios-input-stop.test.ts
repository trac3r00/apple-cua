import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputInterrupted, runInInputScope } from "../computer/input-scope.js";
import type { Point } from "../types/index.js";

const native = vi.hoisted(() => ({
	sleep: vi.fn(async () => {}),
	warp: vi.fn(),
	mouse: vi.fn(),
	scroll: vi.fn(),
	key: vi.fn<(event: { readonly keyCode: number; readonly keyDown: boolean; readonly flags: number }) => void>(),
	record: vi.fn<(_target: unknown, type: number, point: Point) => boolean>(() => true),
	focus: vi.fn(() => null),
}));

vi.mock("node:timers/promises", () => ({ setTimeout: native.sleep }));
vi.mock("./macos-ffi/coregraphics.js", () => ({
	K_CG_EVENT_FLAG_MASK_ALTERNATE: 0x00080000,
	K_CG_EVENT_FLAG_MASK_COMMAND: 0x00100000,
	K_CG_EVENT_FLAG_MASK_CONTROL: 0x00040000,
	K_CG_EVENT_FLAG_MASK_SHIFT: 0x00020000,
	getCurrentCursorPosition: () => ({ x: 11, y: 22 }),
	postKeyboardEvent: native.key,
	postMouseEvent: native.mouse,
	postScrollEvent: native.scroll,
	warpCursorPosition: native.warp,
}));
vi.mock("./macos-ffi/skylight.js", () => ({
	CGS_EVENT_LEFT_MOUSE_DOWN: 1,
	CGS_EVENT_LEFT_MOUSE_DRAGGED: 2,
	CGS_EVENT_LEFT_MOUSE_UP: 3,
	beginFocusWithoutRaise: native.focus,
	postMouseEventRecordToWindow: native.record,
	restoreFrontProcessNoWindows: vi.fn(),
}));
vi.mock("./macos-ffi/pasteboard.js", () => ({ readClipboard: vi.fn(), writeClipboard: vi.fn() }));

import {
	longPressMirroring,
	pressMirroringCombo,
	scrollMirroring,
	swipeMirroring,
	tapMirroring,
	typeIntoMirroring,
} from "./ios-input.js";

const target = {
	pid: 1,
	windowId: 2,
	bounds: { x: 0, y: 0, width: 400, height: 800 },
	delivery: "background",
} as const;
const at = { x: 200, y: 400 };

beforeEach(() => {
	vi.resetAllMocks();
	native.sleep.mockResolvedValue(undefined);
	native.record.mockReturnValue(true);
	native.focus.mockReturnValue(null);
});
afterEach(() => vi.clearAllMocks());

describe("phone native input interruption", () => {
	it.each([
		{ name: "tap", action: async () => tapMirroring(target, at) },
		{ name: "long press", action: async () => longPressMirroring(target, at, 10) },
		{
			name: "swipe",
			action: async () => swipeMirroring(target, { from: at, to: { x: 300, y: 400 }, steps: 2 }),
		},
	])(
		"#given unavailable background delivery #when attempting $name #then never sends global input",
		async ({ action }) => {
			native.record.mockReturnValue(false);

			await expect(action()).rejects.toThrow();

			expect(native.mouse).not.toHaveBeenCalled();
			expect(native.warp).not.toHaveBeenCalled();
			expect(native.focus).not.toHaveBeenCalled();
		},
	);

	it("#given an already stopped scope #when scrolling #then does not borrow the pointer", async () => {
		await expect(
			runInInputScope({ interruption: () => "stopped" }, () =>
				scrollMirroring(target, { at, deltaY: 100, borrowPointer: true }),
			),
		).rejects.toThrow(InputInterrupted);
		expect(native.warp).not.toHaveBeenCalled();
		expect(native.scroll).not.toHaveBeenCalled();
	});

	it("#given a stop during pointer settling #when scrolling resumes #then restores the pointer without input", async () => {
		let stopped = false;
		native.sleep.mockImplementationOnce(async () => {
			stopped = true;
		});

		await expect(
			runInInputScope({ interruption: () => (stopped ? "stopped" : undefined) }, () =>
				scrollMirroring(target, { at, deltaY: 100, borrowPointer: true }),
			),
		).rejects.toThrow(InputInterrupted);

		expect(native.scroll).not.toHaveBeenCalled();
		expect(native.mouse).not.toHaveBeenCalled();
		expect(native.warp.mock.calls).toEqual([[at], [{ x: 11, y: 22 }]]);
	});

	it("#given a stop after one wheel event #when the next event is due #then stops and restores the pointer", async () => {
		let stopped = false;
		native.scroll.mockImplementation(() => {
			stopped = true;
		});

		await expect(
			runInInputScope({ interruption: () => (stopped ? "stopped" : undefined) }, () =>
				scrollMirroring(target, { at, deltaY: 100, steps: 6, borrowPointer: true }),
			),
		).rejects.toThrow(InputInterrupted);

		expect(native.scroll).toHaveBeenCalledTimes(1);
		expect(native.warp.mock.calls).toEqual([[at], [{ x: 11, y: 22 }]]);
	});

	it("#given a stop during a swipe #when the next move is due #then releases the button at its last point", async () => {
		let stopped = false;
		native.record.mockImplementation((_window, type) => {
			if (type === 2) stopped = true;
			return true;
		});

		await expect(
			runInInputScope({ interruption: () => (stopped ? "stopped" : undefined) }, () =>
				swipeMirroring(target, { from: { x: 20, y: 30 }, to: { x: 100, y: 300 }, steps: 6 }),
			),
		).rejects.toThrow(InputInterrupted);

		expect(native.record.mock.calls.map((call) => call[1])).toEqual([1, 2, 3]);
		expect(native.record.mock.calls[2]?.[2]).toEqual(native.record.mock.calls[1]?.[2]);
	});

	it("#given a stop after the first modifier #when pressing a combo #then only held keys are released", async () => {
		let stopped = false;
		native.key.mockImplementation((event) => {
			if (event.keyDown) stopped = true;
		});

		await expect(
			runInInputScope({ interruption: () => (stopped ? "stopped" : undefined) }, () =>
				pressMirroringCombo(target, "cmd+shift+a"),
			),
		).rejects.toThrow(InputInterrupted);

		expect(native.key.mock.calls.map(([event]) => [event.keyCode, event.keyDown, event.flags])).toEqual([
			[55, true, 0x00100000],
			[55, false, 0],
		]);
	});

	it("#given a stop after the first character #when typing #then no later character goes down", async () => {
		let stopped = false;
		native.key.mockImplementation((event) => {
			if (event.keyDown) stopped = true;
		});

		await expect(
			runInInputScope({ interruption: () => (stopped ? "stopped" : undefined) }, () =>
				typeIntoMirroring(target, "ab", { mode: "keystrokes" }),
			),
		).rejects.toThrow(InputInterrupted);

		expect(native.key.mock.calls.map(([event]) => [event.keyCode, event.keyDown])).toEqual([
			[0, true],
			[0, false],
		]);
	});
});
