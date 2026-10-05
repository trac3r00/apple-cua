import { parentPort } from "node:worker_threads";
import { type FocusWatchJob, watchForFocusSteal } from "./macos-focus-watch.js";

/** Worker entry for {@link startFocusStealWatch}: each message is one background input to watch. */
parentPort?.on("message", (job: FocusWatchJob) => {
	watchForFocusSteal({ previousPsn: Buffer.from(job.previousPsn), targetPsn: Buffer.from(job.targetPsn) });
});
parentPort?.postMessage("ready");
