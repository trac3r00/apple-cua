import { Worker } from "node:worker_threads";
import {
	type FocusRestoreToken,
	frontProcessSerialNumber,
	processSerialNumbersMatch,
	restoreFrontProcessNoWindows,
} from "./macos-ffi/skylight.js";
import {
	type PhysicalInputProbe,
	createDeliberateSwitchDetector,
	hidPhysicalInputProbe,
} from "./macos-physical-intent.js";

/**
 * While the target holds the front the person's keystrokes land in it, so the watcher polls on a
 * short interval for the first stretch and keeps one late check for slow activations. Timers are
 * unref'd and polling stops after the window, so the cost is bounded.
 */
const FOCUS_POLL_INTERVAL_MILLISECONDS = 10;
const FOCUS_POLL_WINDOW_MILLISECONDS = 300;
const FOCUS_LATE_CHECK_MILLISECONDS = 800;
/** A Command-Tab can start after the poll window ends, so the keyboard is sampled until the late check. */
const FOCUS_COMMAND_SAMPLE_INTERVAL_MILLISECONDS = 50;

export interface FocusWatchOptions {
	/** Physical keyboard and mouse state; the HID system state unless a test supplies one. */
	readonly physicalInput?: PhysicalInputProbe;
	readonly nowMilliseconds?: () => number;
}

/**
 * Send the person's app back as soon as the target takes the front. It never fights the person:
 * once the front is neither the target nor the app it started from (they switched apps), or the
 * target took the front right after the person's own mouse press or Command key (they switched to
 * it), it stops for good. This runs on this thread's timers; use {@link startFocusStealWatch} to
 * keep it off a busy event loop.
 */
export function watchForFocusSteal(guard: FocusRestoreToken, options: FocusWatchOptions = {}): void {
	const detector = createDeliberateSwitchDetector(
		options.physicalInput ?? hidPhysicalInputProbe,
		options.nowMilliseconds ?? Date.now,
	);
	const timers: NodeJS.Timeout[] = [];
	const stop = (): void => {
		for (const timer of timers) {
			clearInterval(timer);
			clearTimeout(timer);
		}
	};
	const check = (): void => {
		const front = frontProcessSerialNumber();
		if (front === null) {
			return;
		}
		if (processSerialNumbersMatch(front, guard.targetPsn)) {
			if (detector.deliberate()) {
				stop();
			} else {
				restoreFrontProcessNoWindows(guard);
			}
		} else if (!processSerialNumbersMatch(front, guard.previousPsn)) {
			stop();
		}
	};
	const poller = setInterval(() => {
		detector.sample();
		check();
	}, FOCUS_POLL_INTERVAL_MILLISECONDS);
	const commandSampler = setInterval(detector.sample, FOCUS_COMMAND_SAMPLE_INTERVAL_MILLISECONDS);
	timers.push(
		poller,
		commandSampler,
		setTimeout(() => clearInterval(poller), FOCUS_POLL_WINDOW_MILLISECONDS),
		setTimeout(() => {
			clearInterval(commandSampler);
			check();
		}, FOCUS_LATE_CHECK_MILLISECONDS),
	);
	for (const timer of timers) {
		timer.unref();
	}
}

export interface FocusWatchJob {
	readonly previousPsn: Uint8Array;
	readonly targetPsn: Uint8Array;
}

/**
 * The process that handles input spends long stretches inside synchronous native calls (an
 * accessibility walk after the action, say), and a timer on that thread cannot fire until the loop
 * is free: measured, the target kept the front for the whole stretch. A worker thread has a loop of
 * its own, so the watch runs there; if the worker cannot start, the watch falls back to this thread.
 */
let worker: Worker | undefined;
let workerReady = false;
let workerFailed = false;
/** Guards posted to a worker that has not confirmed it is running; they are watched here if it never does. */
const unconfirmedGuards = new Set<FocusRestoreToken>();

function startWorker(): Worker {
	const created = new Worker(new URL("./macos-focus-watch-worker.js", import.meta.url));
	created.unref();
	created.once("message", () => {
		workerReady = true;
		unconfirmedGuards.clear();
	});
	const fail = (): void => {
		workerFailed = true;
		workerReady = false;
		worker = undefined;
		for (const guard of unconfirmedGuards) {
			watchForFocusSteal(guard);
		}
		unconfirmedGuards.clear();
	};
	created.once("error", fail);
	created.once("exit", fail);
	return created;
}

export function startFocusStealWatch(guard: FocusRestoreToken): void {
	if (workerFailed) {
		watchForFocusSteal(guard);
		return;
	}
	// Posted at once: a message waits in the worker's port until it is up, and nothing here depends on
	// this thread's loop turning, which is the thing that may be blocked.
	worker ??= startWorker();
	if (!workerReady) {
		unconfirmedGuards.add(guard);
	}
	const job: FocusWatchJob = { previousPsn: guard.previousPsn, targetPsn: guard.targetPsn };
	worker.postMessage(job);
}
