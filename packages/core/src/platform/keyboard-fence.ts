import type { AxEventWaiter } from "./macos-ffi/ax-observer.js";
import { waitForAxQuiet } from "./macos-ffi/ax-observer.js";

/** Keys older than this have long been handled, so text typed after them needs no fence. */
export const KEYBOARD_FENCE_WINDOW_MS = 500;
/** How long after the keys an app may take to react before it is taken to have nothing to report. */
export const KEYBOARD_FENCE_REACTION_MS = 150;
/** Once the app reacts, it has finished when it stays silent this long. */
export const KEYBOARD_FENCE_QUIET_MS = 40;
/** Upper bound on the whole wait, so a chatty app cannot hold typing back. */
export const KEYBOARD_FENCE_DEADLINE_MS = 400;

export interface KeyboardFenceClock {
	now(): number;
	sleep(milliseconds: number): Promise<void>;
}

export interface KeyboardFenceOutcome {
	readonly waited: boolean;
	readonly events: number;
	readonly elapsedMs: number;
}

const NOT_NEEDED: KeyboardFenceOutcome = { waited: false, events: 0, elapsedMs: 0 };

/**
 * Hold an accessibility write back until the app has handled the keys posted to it just before.
 *
 * Posted key events wait in the app's event queue, while an accessibility write is answered at once,
 * so text typed through accessibility right after Cmd+A could land at the old caret before the app
 * had selected anything ("replace me" + typed text instead of the typed text alone). The keys' own
 * accessibility notifications (selection, value, focus changed) say when they were handled; an app
 * that reports nothing is given the reaction window from the moment the keys were posted.
 */
export async function awaitKeyboardFence(
	lastKeyboardInputAt: number | undefined,
	openWaiter: () => AxEventWaiter | null,
	clock: KeyboardFenceClock,
): Promise<KeyboardFenceOutcome> {
	if (lastKeyboardInputAt === undefined) {
		return NOT_NEEDED;
	}
	const started = clock.now();
	if (started - lastKeyboardInputAt >= KEYBOARD_FENCE_WINDOW_MS) {
		return NOT_NEEDED;
	}
	const waiter = openWaiter();
	if (waiter === null) {
		const remaining = KEYBOARD_FENCE_REACTION_MS - (started - lastKeyboardInputAt);
		if (remaining > 0) {
			await clock.sleep(remaining);
		}
		return { waited: true, events: 0, elapsedMs: clock.now() - started };
	}
	try {
		let events = 0;
		while (events === 0) {
			const remaining = KEYBOARD_FENCE_REACTION_MS - (clock.now() - lastKeyboardInputAt);
			if (remaining <= 0) {
				break;
			}
			events += waiter.drain(Math.min(remaining, KEYBOARD_FENCE_QUIET_MS));
		}
		if (events > 0) {
			const budget = KEYBOARD_FENCE_DEADLINE_MS - (clock.now() - started);
			events += waitForAxQuiet(waiter, {
				quietMs: KEYBOARD_FENCE_QUIET_MS,
				deadlineMs: budget,
				now: clock.now,
			}).events;
		}
		return { waited: true, events, elapsedMs: clock.now() - started };
	} finally {
		waiter.release();
	}
}

/** How long an app may take to react to an accessibility write before it is taken to have finished. */
export const WRITE_SETTLE_REACTION_MS = 150;
/** Upper bound on the wait after a write, so a chatty app cannot hold the next action back. */
export const WRITE_SETTLE_DEADLINE_MS = 400;

/**
 * Hold the next action back until the app has taken in a text write made through accessibility.
 *
 * Setting a field's text over accessibility returns before the app has run its own change handling:
 * TextEdit marks the document edited about a hundred milliseconds later. A key posted in between
 * (Cmd+W, Cmd+S) sees a document that is not yet edited, so it closes without the unsaved-changes
 * prompt or saves the old text. The app's accessibility notifications say when the write was taken
 * in; an app that reports nothing is given the reaction window.
 */
export async function awaitAccessibilityWriteSettled(
	openWaiter: () => AxEventWaiter | null,
	clock: KeyboardFenceClock,
): Promise<KeyboardFenceOutcome> {
	const started = clock.now();
	const waiter = openWaiter();
	if (waiter === null) {
		await clock.sleep(WRITE_SETTLE_REACTION_MS);
		return { waited: true, events: 0, elapsedMs: clock.now() - started };
	}
	try {
		let events = 0;
		while (events === 0) {
			const remaining = WRITE_SETTLE_REACTION_MS - (clock.now() - started);
			if (remaining <= 0) {
				break;
			}
			events += waiter.drain(Math.min(remaining, KEYBOARD_FENCE_QUIET_MS));
		}
		if (events > 0) {
			const budget = WRITE_SETTLE_DEADLINE_MS - (clock.now() - started);
			events += waitForAxQuiet(waiter, {
				quietMs: KEYBOARD_FENCE_QUIET_MS,
				deadlineMs: budget,
				now: clock.now,
			}).events;
		}
		return { waited: true, events, elapsedMs: clock.now() - started };
	} finally {
		waiter.release();
	}
}
