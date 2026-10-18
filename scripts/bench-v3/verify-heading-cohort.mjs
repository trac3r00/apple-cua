import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PAGE_HEADING } from "../bench-v2/fixture.mjs";

export function verifyHeadingCohort(report) {
	const startIteration = report.start_iteration ?? 1;
	if (!report.finished_at || report.runs !== 30 || report.results?.length !== 60)
		throw new Error("incomplete thirty-pair heading cohort");
	if (!Number.isInteger(startIteration) || startIteration < 1) throw new Error("invalid stage start");
	const seen = new Set();
	const counts = { apple: { attempts: 0, completed: 0 }, cua: { attempts: 0, completed: 0 } };
	for (const row of report.results) {
		const identity = `${row.route}:${row.iteration}`;
		if (
			!Object.hasOwn(counts, row.route) ||
			row.scenario !== "safari-heading" ||
			!Number.isInteger(row.iteration) ||
			row.iteration < startIteration ||
			row.iteration >= startIteration + 30 ||
			seen.has(identity) ||
			row.not_started ||
			row.fixture_failed ||
			typeof row.pass !== "boolean"
		)
			throw new Error(`invalid scored attempt: ${identity}`);
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
			throw new Error(`unverified disturbance: ${identity}`);
		if (
			row.cleanup?.error !== null ||
			!Array.isArray(row.cleanup.leftover) ||
			row.cleanup.leftover.length !== 0 ||
			!Array.isArray(row.cleanup.closed) ||
			row.cleanup.closed.length !== 1 ||
			(row.unexpected_windows?.length && row.cleanup.unexpected_absence_verified !== true)
		)
			throw new Error(`unverified cleanup: ${identity}`);
		if (
			typeof row.baseline_nonce !== "string" ||
			(row.pass &&
				(typeof row.oracle_state?.nonce !== "string" ||
					row.oracle_state.nonce === row.baseline_nonce ||
					row.oracle_state.heading !== PAGE_HEADING))
		)
			throw new Error(`unverified document transition: ${identity}`);
		counts[row.route].attempts++;
		counts[row.route].completed += Number(row.pass);
	}
	return { counts, verified_closures: seen.size, zero_recorded_disturbance: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const file = process.argv[2];
	if (!file) throw new Error("usage: verify-heading-cohort <raw>");
	const bytes = readFileSync(file);
	const verified = verifyHeadingCohort(JSON.parse(bytes.toString("utf8")));
	process.stdout.write(
		`${JSON.stringify({ file, sha256: createHash("sha256").update(bytes).digest("hex"), ...verified })}\n`,
	);
}
