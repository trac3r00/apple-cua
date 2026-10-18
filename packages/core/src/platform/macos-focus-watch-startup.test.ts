import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const workerHandlers = new Map<string, () => void>();
	const worker = {
		once: vi.fn((event: string, handler: () => void) => {
			workerHandlers.set(event, handler);
			return worker;
		}),
		postMessage: vi.fn(),
		unref: vi.fn(),
	};
	const previousPsn = Buffer.alloc(8, 1);
	const targetPsn = Buffer.alloc(8, 2);
	const state: { front: Buffer } = { front: previousPsn };
	const intent: { deliberate: boolean } = { deliberate: false };
	return {
		frontProcessSerialNumber: vi.fn(() => state.front),
		intent,
		previousPsn,
		processSerialNumbersMatch: (left: Buffer, right: Buffer) => left.equals(right),
		restoreFrontProcessNoWindows: vi.fn(),
		state,
		targetPsn,
		worker,
		workerHandlers,
	};
});

vi.mock("node:worker_threads", () => ({ Worker: vi.fn(() => mocks.worker) }));
vi.mock("./macos-ffi/skylight.js", () => ({
	frontProcessSerialNumber: mocks.frontProcessSerialNumber,
	processSerialNumbersMatch: mocks.processSerialNumbersMatch,
	restoreFrontProcessNoWindows: mocks.restoreFrontProcessNoWindows,
}));
vi.mock("./macos-physical-intent.js", () => ({
	createDeliberateSwitchDetector: () => ({ deliberate: () => mocks.intent.deliberate, sample: vi.fn() }),
	hidPhysicalInputProbe: { commandHeld: () => false, secondsSinceMouseDown: () => Number.POSITIVE_INFINITY },
}));

describe("#given a focus watch whose worker has not reported ready", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
		mocks.workerHandlers.clear();
		mocks.worker.once.mockClear();
		mocks.worker.postMessage.mockClear();
		mocks.frontProcessSerialNumber.mockClear();
		mocks.restoreFrontProcessNoWindows.mockClear();
		mocks.state.front = mocks.previousPsn;
		mocks.intent.deliberate = false;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("#when the target takes focus before worker readiness #then local protection restores the previous app", async () => {
		const { startFocusStealWatch } = await import("./macos-focus-watch.js");
		startFocusStealWatch({ previousPsn: mocks.previousPsn, targetPsn: mocks.targetPsn });

		mocks.state.front = mocks.targetPsn;
		await vi.advanceTimersByTimeAsync(10);

		expect(mocks.restoreFrontProcessNoWindows).toHaveBeenCalledWith({
			previousPsn: mocks.previousPsn,
			targetPsn: mocks.targetPsn,
		});
	});

	it("#when a third app becomes frontmost before readiness #then local protection leaves it alone", async () => {
		const { startFocusStealWatch } = await import("./macos-focus-watch.js");
		startFocusStealWatch({ previousPsn: mocks.previousPsn, targetPsn: mocks.targetPsn });

		mocks.state.front = Buffer.alloc(8, 3);
		await vi.advanceTimersByTimeAsync(10);

		expect(mocks.restoreFrontProcessNoWindows).not.toHaveBeenCalled();
	});

	it("#when the person deliberately switches to the target #then local protection leaves it in front", async () => {
		const { startFocusStealWatch } = await import("./macos-focus-watch.js");
		startFocusStealWatch({ previousPsn: mocks.previousPsn, targetPsn: mocks.targetPsn });

		mocks.intent.deliberate = true;
		mocks.state.front = mocks.targetPsn;
		await vi.advanceTimersByTimeAsync(10);

		expect(mocks.restoreFrontProcessNoWindows).not.toHaveBeenCalled();
	});

	it("#when the worker fails before readiness #then local protection remains active", async () => {
		const { startFocusStealWatch } = await import("./macos-focus-watch.js");
		startFocusStealWatch({ previousPsn: mocks.previousPsn, targetPsn: mocks.targetPsn });
		mocks.workerHandlers.get("error")?.();

		mocks.state.front = mocks.targetPsn;
		await vi.advanceTimersByTimeAsync(10);

		expect(mocks.restoreFrontProcessNoWindows).toHaveBeenCalledWith({
			previousPsn: mocks.previousPsn,
			targetPsn: mocks.targetPsn,
		});
	});

	it("#when startup protection sees a deliberate switch before readiness #then no queued worker can undo it", async () => {
		const { startFocusStealWatch } = await import("./macos-focus-watch.js");
		startFocusStealWatch({ previousPsn: mocks.previousPsn, targetPsn: mocks.targetPsn });
		mocks.intent.deliberate = true;
		mocks.state.front = mocks.targetPsn;
		await vi.advanceTimersByTimeAsync(10);

		mocks.workerHandlers.get("message")?.();
		await vi.runAllTimersAsync();

		expect(mocks.worker.postMessage).not.toHaveBeenCalled();
		expect(mocks.restoreFrontProcessNoWindows).not.toHaveBeenCalled();
	});

	it("#when a ready worker fails after the startup watch expires #then the next job installs local protection", async () => {
		const { startFocusStealWatch } = await import("./macos-focus-watch.js");
		const guard = { previousPsn: mocks.previousPsn, targetPsn: mocks.targetPsn };
		startFocusStealWatch(guard);
		mocks.workerHandlers.get("message")?.();
		await vi.runAllTimersAsync();
		mocks.frontProcessSerialNumber.mockClear();
		mocks.worker.postMessage.mockClear();

		mocks.workerHandlers.get("error")?.();
		startFocusStealWatch(guard);
		mocks.state.front = mocks.targetPsn;
		await vi.advanceTimersByTimeAsync(10);

		expect(mocks.restoreFrontProcessNoWindows).toHaveBeenCalledWith(guard);
		expect(mocks.worker.postMessage).not.toHaveBeenCalled();
	});
});
