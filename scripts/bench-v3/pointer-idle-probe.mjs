import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDisturbance } from "./disturbance.mjs";

// Elapsed time is the measurement: observe a fixed no-input control,
// not a readiness delay or a task-success timeout.
const output = process.argv[2] ?? ".bench/v3/pointer-idle-control.json";
const seconds = Number(process.argv[3] ?? 30);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error("invalid observation duration");
if (existsSync(output)) throw new Error("existing control artifact refused");
const directory = mkdtempSync(join(tmpdir(), "cua-pointer-idle-"));
const binary = join(directory, "trace");
let trace;
let interrupted = false;
let timer;
let finishObservation;
const stop = () => {
	interrupted = true;
	clearTimeout(timer);
	finishObservation?.();
};
try {
	execFileSync("swiftc", [fileURLToPath(new URL("./disturbance.swift", import.meta.url)), "-o", binary], {
		timeout: 60000,
	});
	trace = await startDisturbance(binary);
	const start = Date.now();
	for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
	await new Promise((resolve) => {
		finishObservation = resolve;
		timer = setTimeout(resolve, seconds * 1000);
	});
	const observation = await trace.stop();
	trace = null;
	const report = {
		scope: `${seconds}-second read-only cursor and activation control; no MCP calls, app launch or input`,
		start_epoch_ms: start,
		end_epoch_ms: Date.now(),
		interrupted,
		trace: observation,
		process_inventory: execFileSync("ps", ["-axo", "pid,ppid,comm"], {
			encoding: "utf8",
			timeout: 10000,
		}),
	};
	writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
	clearTimeout(timer);
	for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, stop);
	trace?.cancel();
	rmSync(directory, { recursive: true });
}
