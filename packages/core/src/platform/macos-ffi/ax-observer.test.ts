import { describe, expect, it } from "vitest";

import { type AxEventWaiter, createAxEventWaiter, isAxObserverAvailable, waitForAxQuiet } from "./ax-observer.js";

function scriptedWaiter(drains: readonly number[], clock: { value: number }): AxEventWaiter {
	let call = 0;
	return {
		drain(milliseconds: number): number {
			clock.value += milliseconds;
			const result = drains[call] ?? 0;
			call += 1;
			return result;
		},
		release(): void {},
	};
}

describe("#given a waiter that reports no events #when the quiet period runs #then it returns after one window", () => {
	it("costs a single quiet window", () => {
		const clock = { value: 0 };
		const waiter = scriptedWaiter([0], clock);

		const outcome = waitForAxQuiet(waiter, { quietMs: 60, deadlineMs: 300, now: () => clock.value });

		expect(outcome).toEqual({ quiet: true, events: 0, elapsedMs: 60 });
	});
});

describe("#given a waiter that keeps reporting events #when the deadline elapses #then it reports the busy outcome", () => {
	it("keeps waiting until the deadline and reports not quiet", () => {
		const clock = { value: 0 };
		const waiter = scriptedWaiter([1, 1, 1, 1, 1, 1], clock);

		const outcome = waitForAxQuiet(waiter, { quietMs: 60, deadlineMs: 150, now: () => clock.value });

		expect(outcome.quiet).toBe(false);
		expect(outcome.events).toBeGreaterThanOrEqual(3);
		expect(outcome.elapsedMs).toBeLessThanOrEqual(151);
	});
});

describe("#given a waiter that goes quiet after activity #when the quiet period runs #then it settles after the activity", () => {
	it("adds up the events seen before quiet", () => {
		const clock = { value: 0 };
		const waiter = scriptedWaiter([3, 0], clock);

		const outcome = waitForAxQuiet(waiter, { quietMs: 60, deadlineMs: 300, now: () => clock.value });

		expect(outcome).toEqual({ quiet: true, events: 3, elapsedMs: 120 });
	});
});

describe("#given a settle deadline that is already spent #when the quiet period runs #then it returns immediately", () => {
	it("does not drain", () => {
		const clock = { value: 0 };
		const waiter = scriptedWaiter([5], clock);

		const outcome = waitForAxQuiet(waiter, { quietMs: 60, deadlineMs: 0, now: () => clock.value });

		expect(outcome).toEqual({ quiet: true, events: 0, elapsedMs: 0 });
		expect(clock.value).toBe(0);
	});
});

describe("#given an unusable application id #when a waiter is requested #then none is created", () => {
	it.each([0, -1, 1.5, Number.NaN])("returns null for pid %s", (pid) => {
		expect(createAxEventWaiter(pid)).toBeNull();
	});
});

describe("#given this macOS host #when the observer is probed #then the platform calls are present", () => {
	it("reports availability", () => {
		expect(isAxObserverAvailable()).toBe(true);
	});
});
