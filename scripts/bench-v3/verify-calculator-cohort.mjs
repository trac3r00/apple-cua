import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("usage: verify-calculator-cohort <raw>");
const bytes = readFileSync(file);
const report = JSON.parse(bytes.toString("utf8"));
if (!report.finished_at || report.cleanup?.verified !== true || report.cleanup_error)
	throw new Error("owned process termination unverified");
const seen = new Set();
const counts = { apple: { attempts: 0, completed: 0 }, cua: { attempts: 0, completed: 0 } };
for (const row of report.results) {
	const identity = `${row.route}:${row.iteration}`;
	if (
		!["apple", "cua"].includes(row.route) ||
		row.scenario !== "calculator-add" ||
		!Number.isInteger(row.iteration) ||
		row.iteration < 1 ||
		row.iteration > 30 ||
		seen.has(identity)
	)
		throw new Error(`unexpected or repeated identity: ${identity}`);
	seen.add(identity);
	const trace = row.disturbance_trace;
	if (
		row.focus_disturbance !== false ||
		row.pointer_disturbance !== false ||
		!Number.isFinite(trace?.max_cursor_px) ||
		trace.max_cursor_px > 2 ||
		!Array.isArray(trace.activations) ||
		trace.activations.length !== 0
	)
		throw new Error(`disturbance evidence unverified: ${identity}`);
	counts[row.route].attempts++;
	counts[row.route].completed += Number(row.pass === true);
}
if (seen.size !== 60) throw new Error("incomplete thirty-pair cohort");
process.stdout.write(
	`${JSON.stringify({ file, sha256: createHash("sha256").update(bytes).digest("hex"), counts, owned_pid: report.cleanup.pid, owned_pid_gone: true, zero_recorded_disturbance: true, fixture_lifecycle: "one newly owned Calculator process across the cohort; final termination, not sixty per-attempt process closures" })}\n`,
);
