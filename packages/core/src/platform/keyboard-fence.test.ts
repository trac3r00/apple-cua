import { describe, expect, it, vi } from "vitest";

import {
	KEYBOARD_FENCE_DEADLINE_MS,
	KEYBOARD_FENCE_QUIET_MS,
	KEYBOARD_FENCE_REACTION_MS,
	WRITE_SETTLE_DEADLINE_MS,
	WRITE_SETTLE_REACTION_MS,
	awaitAccessibilityWriteSettled,
	awaitKeyboardFence,
} from "./keyboard-fence.js";

/** A simulated app: its accessibility notifications fire at the given times on a virtual clock. */
function simulatedApp(eventTimes: readonly number[]) {
	let time = 0;
	let released = 0;
	const pending = [...eventTimes];
	const clock = {
		now: () => time,
		sleep: async (milliseconds: number) => {
			time += milliseconds;
		},
	};
	const waiter = {
		// Like CFRunLoopRunInMode, a drain returns as soon as one notification was handled.
		drain(milliseconds: number): number {
			const until = time + milliseconds;
			const next = pending[0];
			if (next !== undefined && next <= until) {
				pending.shift();
				time = Math.max(time, next);
				return 1;
			}
			time = until;
			return 0;
		},
		release() {
			released += 1;
		},
	};
	return {
		clock,
		waiter,
		released: () => released,
		advance: (ms: number) => {
			time += ms;
		},
	};
}

describe("#given text typed through accessibility after keyboard input", () => {
	it("#when no key was posted to the app #then typing proceeds at once without subscribing", async () => {
		const app = simulatedApp([]);
		const openWaiter = vi.fn(() => app.waiter);

		const outcome = await awaitKeyboardFence(undefined, openWaiter, app.clock);

		expect(outcome.waited).toBe(false);
		expect(openWaiter).not.toHaveBeenCalled();
	});

	it("#when the keys were posted long ago #then typing proceeds at once", async () => {
		const app = simulatedApp([]);
		app.advance(10_000);
		const openWaiter = vi.fn(() => app.waiter);

		const outcome = await awaitKeyboardFence(0, openWaiter, app.clock);

		expect(outcome.waited).toBe(false);
		expect(openWaiter).not.toHaveBeenCalled();
	});

	it("#when the app handles Cmd+A after a delay #then typing waits until the selection change has landed and settled", async () => {
		// given: Cmd+A posted at t=0, the app reports its selection change at t=70 and a value echo at t=90
		const app = simulatedApp([70, 90]);

		// when
		const outcome = await awaitKeyboardFence(0, () => app.waiter, app.clock);

		// then: the write happens only after the last reaction plus one quiet window
		expect(outcome.events).toBe(2);
		expect(app.clock.now()).toBeGreaterThanOrEqual(90 + KEYBOARD_FENCE_QUIET_MS);
		expect(app.released()).toBe(1);
	});

	it("#when the app never reports anything #then typing waits out the reaction window and no longer", async () => {
		const app = simulatedApp([]);

		const outcome = await awaitKeyboardFence(0, () => app.waiter, app.clock);

		expect(outcome.events).toBe(0);
		expect(app.clock.now()).toBe(KEYBOARD_FENCE_REACTION_MS);
		expect(app.released()).toBe(1);
	});

	it("#when the app keeps reporting changes #then the wait is capped by the deadline", async () => {
		const chatter = Array.from({ length: 100 }, (_, index) => 10 + index * 10);
		const app = simulatedApp(chatter);

		await awaitKeyboardFence(0, () => app.waiter, app.clock);

		expect(app.clock.now()).toBeLessThanOrEqual(KEYBOARD_FENCE_DEADLINE_MS + KEYBOARD_FENCE_QUIET_MS);
		expect(app.released()).toBe(1);
	});

	it("#when accessibility notifications are unavailable #then typing waits out the rest of the reaction window", async () => {
		const app = simulatedApp([]);
		app.advance(40);

		const outcome = await awaitKeyboardFence(0, () => null, app.clock);

		expect(outcome.waited).toBe(true);
		expect(app.clock.now()).toBe(KEYBOARD_FENCE_REACTION_MS);
	});
});

describe("#given a text write made through accessibility #when the next action is about to run", () => {
	it("#then it waits until the app has reported the change and gone quiet", async () => {
		// TextEdit reports the edit ~100 ms after the write returns; a key sent before that closes or saves
		// the document as if nothing had changed.
		const app = simulatedApp([100, 120]);

		const outcome = await awaitAccessibilityWriteSettled(() => app.waiter, app.clock);

		expect(outcome.events).toBe(2);
		expect(app.clock.now()).toBeGreaterThanOrEqual(120 + KEYBOARD_FENCE_QUIET_MS);
		expect(app.released()).toBe(1);
	});

	it("#then an app that reports nothing is given the reaction window and no more", async () => {
		const app = simulatedApp([]);

		await awaitAccessibilityWriteSettled(() => app.waiter, app.clock);

		expect(app.clock.now()).toBe(WRITE_SETTLE_REACTION_MS);
	});

	it("#then a chatty app cannot hold the next action past the deadline", async () => {
		const app = simulatedApp(Array.from({ length: 100 }, (_, index) => 10 + index * 10));

		await awaitAccessibilityWriteSettled(() => app.waiter, app.clock);

		expect(app.clock.now()).toBeLessThanOrEqual(WRITE_SETTLE_DEADLINE_MS + KEYBOARD_FENCE_QUIET_MS);
	});
});
