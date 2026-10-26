import { type AxEventWaiter, createAxEventWaiter, waitForAxQuiet } from "@apple-cua/core";

/**
 * How long a deferred outcome waits for the app's own accessibility change events before it is
 * reported: events inside the budget say the input landed, silence says only that nothing was
 * seen. The quiet window keeps a burst of notifications from being cut short.
 */
export const DEFERRED_SETTLE_QUIET_MS = 30;
export const DEFERRED_SETTLE_DEADLINE_MS = 100;

export interface DeferredOutcomeSettle {
	readonly events: number;
	readonly settleMs: number;
}

export type AxWaiterFactory = (pid: number) => AxEventWaiter | null;

/**
 * The stand-in for a result read on a deferred call: dispatch returned, so watch the app's own
 * accessibility notifications for a bounded window. Blocking, like the write-settle fence - it
 * runs on the caller's turn, never in parallel with another action on the same app.
 */
export function settleDeferredOutcome(
	pid: number,
	options: {
		readonly waiterFactory?: AxWaiterFactory;
		readonly now?: () => number;
		readonly quietMs?: number;
		readonly deadlineMs?: number;
	} = {},
): DeferredOutcomeSettle {
	const now = options.now ?? ((): number => performance.now());
	const quietMs = options.quietMs ?? DEFERRED_SETTLE_QUIET_MS;
	const deadlineMs = options.deadlineMs ?? DEFERRED_SETTLE_DEADLINE_MS;
	const started = now();
	const waiter = (options.waiterFactory ?? createAxEventWaiter)(pid);
	if (waiter === null) {
		return { events: 0, settleMs: 0 };
	}
	try {
		let events = 0;
		while (events === 0) {
			const remaining = deadlineMs - (now() - started);
			if (remaining <= 0) {
				break;
			}
			events += waiter.drain(Math.min(remaining, quietMs));
		}
		if (events > 0) {
			const budget = deadlineMs - (now() - started);
			events += waitForAxQuiet(waiter, { quietMs, deadlineMs: budget, now }).events;
		}
		return { events, settleMs: Math.round(now() - started) };
	} catch {
		return { events: 0, settleMs: 0 };
	} finally {
		waiter.release();
	}
}
