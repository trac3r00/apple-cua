import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [file, firstText, lastText] = process.argv.slice(2);
const first = Number(firstText);
const last = Number(lastText);
if (!file || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first)
	throw new Error("usage: verify-text-extension <raw> <first-block> <last-block>");
const bytes = readFileSync(file);
const report = JSON.parse(bytes.toString("utf8"));
const seen = new Set();
const counts = { apple: { attempts: 0, completed: 0 }, cua: { attempts: 0, completed: 0 } };
for (const row of report.results) {
	if (
		!counts[row.route] ||
		row.scenario !== "textedit-two-windows" ||
		!Number.isInteger(row.iteration) ||
		row.iteration < first ||
		row.iteration > last
	)
		throw new Error("unexpected attempt identity");
	const identity = `${row.route}:${row.iteration}`;
	if (seen.has(identity)) throw new Error(`duplicate attempt: ${identity}`);
	seen.add(identity);
	if (
		row.cleanup?.error ||
		row.cleanup?.attempted !== true ||
		!Array.isArray(row.cleanup?.leftover) ||
		row.cleanup.leftover.length !== 0
	)
		throw new Error(`cleanup unverified: ${identity}`);
	if (
		row.focus_disturbance !== false ||
		row.pointer_disturbance !== false ||
		!row.disturbance_trace ||
		!Number.isFinite(row.disturbance_trace.max_cursor_px) ||
		row.disturbance_trace.max_cursor_px > 2 ||
		!Array.isArray(row.disturbance_trace.activations) ||
		row.disturbance_trace.activations.length !== 0
	)
		throw new Error(`disturbance or missing trace: ${identity}`);
	counts[row.route].attempts++;
	counts[row.route].completed += Number(row.pass === true);
}
if (seen.size !== (last - first + 1) * 2 || !report.finished_at) throw new Error("incomplete extension cohort");
process.stdout.write(
	`${JSON.stringify({ file, sha256: createHash("sha256").update(bytes).digest("hex"), first, last, counts, verified_cleanups: seen.size, zero_recorded_disturbance: true })}\n`,
);
