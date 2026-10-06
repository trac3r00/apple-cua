import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	...coreGraphicsMock,
}));
// The target sits behind the person's app in every case here, and is never told it is active.
vi.mock("./macos-ffi/skylight.js", () => ({
	focusGuardFor: () => null,
	setProcessAppActive: vi.fn(() => false),
	beginFocusWithoutRaise: vi.fn(() => null),
	frontProcessSerialNumber: vi.fn(() => null),
	processSerialNumbersMatch: () => false,
	restoreFrontProcessNoWindows: vi.fn(() => true),
}));

import { InputInterrupted, type InputScope, runInInputScope } from "../computer/input-scope.js";
import { NOOP_POINTER_OVERLAY } from "./macos-ffi/cursor-overlay.js";
import {
	MacOSInputController,
	setFocusStealWatcherForTesting,
	setKeyboardPidResolverForTesting,
	setKeyboardWindowFocuserForTesting,
	setOnscreenWindowIdsSourceForTesting,
	setPointWindowIdsForTesting,
} from "./macos-input.js";
import { setOpenWindowsSourceForTesting } from "./macos-open-windows.js";

const NO_SLEEP = { acquire: () => undefined, release: () => undefined };

/** Two documents of app 42, window 11 in front and overlapping window 12; app 77 has window 21. */
const FRONT = { id: 11, bounds: { x: 0, y: 0, width: 400, height: 300 }, owner: { processId: 42 } };
const BEHIND = { id: 12, bounds: { x: 100, y: 100, width: 400, height: 300 }, owner: { processId: 42 } };
const OTHER_APP = { id: 21, bounds: { x: 600, y: 0, width: 300, height: 200 }, owner: { processId: 77 } };
const window12 = { id: 12, bounds: BEHIND.bounds };
const window21 = { id: 21, bounds: OTHER_APP.bounds };

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(): void {
			resolvePromise?.();
		},
	};
}

function backgroundController(): MacOSInputController {
	return new MacOSInputController(undefined, NOOP_POINTER_OVERLAY, () => false, NO_SLEEP, "background");
}

function boundTo(pid: number, windowId: number, interruption?: () => string | undefined): InputScope {
	return interruption === undefined ? { target: { pid, windowId } } : { target: { pid, windowId }, interruption };
}

beforeEach(() => {
	vi.clearAllMocks();
	coreGraphicsMock.postKeyboardEvent.mockImplementation(() => undefined);
	coreGraphicsMock.postMouseEvent.mockImplementation(() => undefined);
	coreGraphicsMock.postUnicodeText.mockImplementation(() => undefined);
	setOpenWindowsSourceForTesting(() => [FRONT, BEHIND, OTHER_APP]);
	setOnscreenWindowIdsSourceForTesting(() => [11, 12, 21]);
	setKeyboardWindowFocuserForTesting(async () => undefined);
	setKeyboardPidResolverForTesting((pid) => pid);
	setFocusStealWatcherForTesting(() => undefined);
	setPointWindowIdsForTesting(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe("#given input calls for two apps that overlap #when one waits mid-call #then every event keeps its own app and window", () => {
	it("#when typing for one app is parked on its window focus while another app is typed into and clicked #then no event crosses over", async () => {
		// given
		const controller = backgroundController();
		const firstParked = deferred();
		const releaseFirst = deferred();
		setKeyboardWindowFocuserForTesting(async (pid) => {
			if (pid === 42) {
				firstParked.resolve();
				await releaseFirst.promise;
			}
		});

		// when
		const first = runInInputScope(boundTo(42, 12), () => controller.typeText("ab"));
		await firstParked.promise;
		await runInInputScope(boundTo(77, 21), async () => {
			await controller.typeText("xy");
			await controller.click({ x: 650, y: 50 });
		});
		releaseFirst.resolve();
		await first;

		// then
		expect(coreGraphicsMock.postUnicodeText.mock.calls).toEqual([
			["x", 77, window21],
			["y", 77, window21],
			["a", 42, window12],
			["b", 42, window12],
		]);
		expect(
			coreGraphicsMock.postMouseEvent.mock.calls.map(([event]) => [event.targetPid, event.targetWindow]),
		).toEqual([
			[77, window21],
			[77, window21],
		]);
		controller.close();
	});
});

describe("#given background delivery #when input has no target app #then nothing is posted at all", () => {
	it("#when every kind of input is tried without a target #then each is refused before any event goes out", async () => {
		// given
		const controller = backgroundController();
		const nowhere = { x: 5, y: 5 };

		// when / then
		await expect(controller.typeText("x")).rejects.toThrow("background delivery cannot type without a target app");
		await expect(controller.pressKey("a")).rejects.toThrow(
			"background delivery cannot press keys without a target app",
		);
		await expect(controller.click(nowhere)).rejects.toThrow("background delivery cannot click without a target app");
		await expect(controller.doubleClick(nowhere)).rejects.toThrow("cannot double click without a target app");
		await expect(controller.drag({ from: nowhere, to: { x: 9, y: 9 } })).rejects.toThrow("cannot drag");
		await expect(controller.scroll({ direction: "down", amount: 3 })).rejects.toThrow("cannot scroll");
		await expect(controller.move(nowhere)).rejects.toThrow("cannot move the pointer");
		// A scope that only carries a stop check names no app either.
		await expect(runInInputScope({ interruption: () => undefined }, () => controller.typeText("x"))).rejects.toThrow(
			"without a target app",
		);

		expect(coreGraphicsMock.postKeyboardEvent).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postUnicodeText).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postScrollEvent).not.toHaveBeenCalled();
		controller.close();
	});
});

describe("#given a stop arrives while input is going out #when the call is mid-way #then nothing more goes out but held input is released", () => {
	it("#when the stop comes after the third character #then the rest of the text is never typed", async () => {
		// given
		const controller = backgroundController();
		let stopped = false;
		coreGraphicsMock.postUnicodeText.mockImplementation(() => {
			stopped = coreGraphicsMock.postUnicodeText.mock.calls.length >= 3;
		});

		// when
		const typing = runInInputScope(
			boundTo(42, 12, () => (stopped ? "the user stopped computer use" : undefined)),
			() => controller.typeText("abcdefgh"),
		);

		// then
		await expect(typing).rejects.toThrow(new InputInterrupted("the user stopped computer use"));
		expect(coreGraphicsMock.postUnicodeText.mock.calls.map(([text]) => text)).toEqual(["a", "b", "c"]);
		controller.close();
	});

	it("#when the stop comes during a long key hold #then the key is released early and the next key never goes down", async () => {
		// given
		vi.useFakeTimers();
		const controller = backgroundController();
		let stopped = false;
		coreGraphicsMock.postKeyboardEvent.mockImplementation((event: { readonly keyDown: boolean }) => {
			stopped = stopped || event.keyDown;
		});
		const scope = boundTo(42, 12, () => (stopped ? "stopped" : undefined));

		// when
		const holding = runInInputScope(scope, () => controller.pressKey("a", { holdMilliseconds: 10_000 })).then(
			() => "completed",
			(error: unknown) => error,
		);
		await vi.advanceTimersByTimeAsync(50);
		const held = await holding;
		const next = await runInInputScope(scope, () => controller.pressKey("b")).then(
			() => "completed",
			(error: unknown) => error,
		);

		// then
		expect(held).toEqual(new InputInterrupted("stopped"));
		expect(next).toEqual(new InputInterrupted("stopped"));
		expect(coreGraphicsMock.postKeyboardEvent.mock.calls.map(([event]) => [event.keyCode, event.keyDown])).toEqual([
			[0, true],
			[0, false],
		]);
		expect(vi.getTimerCount()).toBe(0);
		controller.close();
	});

	it("#when the stop comes between drag steps #then the button is released where the pointer is and no move follows", async () => {
		// given
		const controller = backgroundController();
		let stopped = false;
		coreGraphicsMock.postMouseEvent.mockImplementation(() => {
			const moves = coreGraphicsMock.postMouseEvent.mock.calls.filter(([posted]) => posted.kind === "drag").length;
			stopped = stopped || moves >= 2;
		});

		// when
		const dragging = runInInputScope(
			boundTo(42, 12, () => (stopped ? "stopped" : undefined)),
			() => controller.drag({ from: { x: 150, y: 150 }, to: { x: 450, y: 350 }, duration: 160 }),
		);

		// then
		await expect(dragging).rejects.toThrow(new InputInterrupted("stopped"));
		const posted = coreGraphicsMock.postMouseEvent.mock.calls.map(([event]) => event);
		expect(posted.map((event) => event.kind)).toEqual(["down", "drag", "drag", "up"]);
		expect(posted[3]?.position).toEqual(posted[2]?.position);
		controller.close();
	});
});

describe("#given two overlapping windows of one app #when input is bound to the window behind #then it never reaches the window in front", () => {
	const covered = { x: 150, y: 150 };

	it("#when an unbound click lands where the windows overlap #then it goes to the app's front window there, as before", async () => {
		const controller = backgroundController();

		await runInInputScope({ target: { pid: 42 } }, () => controller.click(covered));

		expect(coreGraphicsMock.postMouseEvent.mock.calls.map(([event]) => event.targetWindow.id)).toEqual([11, 11]);
		controller.close();
	});

	it("#when a bound click lands where the front window covers the bound one #then the event is addressed to the bound window", async () => {
		const controller = backgroundController();
		setPointWindowIdsForTesting(() => [11]);

		await runInInputScope(boundTo(42, 12), () => controller.click(covered));

		expect(
			coreGraphicsMock.postMouseEvent.mock.calls.map(([event]) => [event.targetPid, event.targetWindow]),
		).toEqual([
			[42, window12],
			[42, window12],
		]);
		controller.close();
	});

	it("#when the covering window is a sheet of the bound window #then the sheet takes the click", async () => {
		const controller = backgroundController();
		setPointWindowIdsForTesting(() => [11, 12]);

		await runInInputScope(boundTo(42, 12), () => controller.click(covered));

		expect(coreGraphicsMock.postMouseEvent.mock.calls.map(([event]) => event.targetWindow.id)).toEqual([11, 11]);
		controller.close();
	});

	it("#when the point is outside the bound window, or the bound window is gone #then the click is refused unsent", async () => {
		const controller = backgroundController();

		await expect(runInInputScope(boundTo(42, 12), () => controller.click({ x: 50, y: 50 }))).rejects.toThrow(
			"is outside the observed window 12",
		);
		await expect(runInInputScope(boundTo(42, 13), () => controller.click(covered))).rejects.toThrow(
			"the observed window 13 is no longer on screen",
		);
		await expect(runInInputScope(boundTo(42, 13), () => controller.typeText("x"))).rejects.toThrow(
			"the observed window 13 is no longer on screen",
		);

		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postUnicodeText).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when keys are bound to the window behind #then that window is focused in its app and takes the keys", async () => {
		const controller = backgroundController();
		const focused: Array<readonly [number, number]> = [];
		setKeyboardWindowFocuserForTesting(async (pid, windowId) => {
			focused.push([pid, windowId]);
		});
		// The app last took pointer input in its front window; the bound keys must not follow it there.
		await runInInputScope({ target: { pid: 42 } }, () => controller.click({ x: 50, y: 50 }));

		await runInInputScope(boundTo(42, 12), () => controller.typeText("k"));

		expect(focused).toEqual([[42, 12]]);
		expect(coreGraphicsMock.postUnicodeText.mock.calls).toEqual([["k", 42, window12]]);
		controller.close();
	});
});
