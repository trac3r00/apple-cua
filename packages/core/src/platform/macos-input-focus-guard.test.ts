import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const skyLightMock = vi.hoisted(() => {
	const previousPsn = Buffer.alloc(8, 1);
	const targetPsn = Buffer.alloc(8, 2);
	const otherPsn = Buffer.alloc(8, 3);
	const state: { front: Buffer | null } = { front: previousPsn };
	return {
		focusGuardFor: vi.fn(),
		frontProcessSerialNumber: vi.fn(() => state.front),
		otherPsn,
		previousPsn,
		processSerialNumbersMatch: (left: Buffer, right: Buffer) => left.equals(right),
		restoreFrontProcessNoWindows: vi.fn(() => true),
		state,
		targetPsn,
	};
});

vi.mock("./macos-ffi/skylight.js", () => ({
	focusGuardFor: skyLightMock.focusGuardFor,
	frontProcessSerialNumber: skyLightMock.frontProcessSerialNumber,
	processSerialNumbersMatch: skyLightMock.processSerialNumbersMatch,
	restoreFrontProcessNoWindows: skyLightMock.restoreFrontProcessNoWindows,
}));

const guard = { previousPsn: skyLightMock.previousPsn, targetPsn: skyLightMock.targetPsn };

describe("#given a background input that may make the target take the front", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		skyLightMock.state.front = skyLightMock.previousPsn;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("#when the target takes the front #then the person's app is restored within one poll interval", async () => {
		// given
		const { watchForFocusSteal } = await import("./macos-focus-watch.js");
		watchForFocusSteal(guard);
		await vi.advanceTimersByTimeAsync(120);
		expect(skyLightMock.restoreFrontProcessNoWindows).not.toHaveBeenCalled();

		// when
		skyLightMock.state.front = skyLightMock.targetPsn;
		await vi.advanceTimersByTimeAsync(10);

		// then
		expect(skyLightMock.restoreFrontProcessNoWindows).toHaveBeenCalledWith(guard);
	});

	it("#when the person switches to a third app #then the watcher stops and never restores", async () => {
		// given
		const { watchForFocusSteal } = await import("./macos-focus-watch.js");
		watchForFocusSteal(guard);

		// when
		skyLightMock.state.front = skyLightMock.otherPsn;
		await vi.advanceTimersByTimeAsync(20);
		skyLightMock.state.front = skyLightMock.targetPsn;
		await vi.advanceTimersByTimeAsync(1000);

		// then
		expect(skyLightMock.restoreFrontProcessNoWindows).not.toHaveBeenCalled();
	});

	it("#when the polling window ends #then polling stops but the late check still restores a slow activation", async () => {
		// given
		const { watchForFocusSteal } = await import("./macos-focus-watch.js");
		watchForFocusSteal(guard);
		await vi.advanceTimersByTimeAsync(400);
		const callsAfterWindow = skyLightMock.frontProcessSerialNumber.mock.calls.length;

		// when
		await vi.advanceTimersByTimeAsync(300);
		const callsWhileIdle = skyLightMock.frontProcessSerialNumber.mock.calls.length;
		skyLightMock.state.front = skyLightMock.targetPsn;
		await vi.advanceTimersByTimeAsync(200);

		// then
		expect(callsWhileIdle).toBe(callsAfterWindow);
		expect(skyLightMock.restoreFrontProcessNoWindows).toHaveBeenCalledTimes(1);
	});
});
