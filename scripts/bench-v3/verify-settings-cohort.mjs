import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifySettingsCohort(report) {
	const start = report.start_iteration ?? 1;
	if (
		!report.finished_at ||
		report.runs !== 30 ||
		report.results?.length !== 60 ||
		!Number.isInteger(start) ||
		start < 1
	)
		throw new Error("incomplete Settings cohort");
	const seen = new Set();
	const pids = new Set();
	const counts = { apple: { n: 0, pass: 0 }, cua: { n: 0, pass: 0 } };
	for (const row of report.results) {
		const identity = `${row.route}:${row.iteration}`;
		if (
			!Object.hasOwn(counts, row.route) ||
			row.scenario !== "settings-version" ||
			!Number.isInteger(row.iteration) ||
			row.iteration < start ||
			row.iteration >= start + 30 ||
			seen.has(identity) ||
			row.fixture_failed ||
			row.not_started ||
			typeof row.pass !== "boolean" ||
			!Number.isFinite(row.e2e_seconds)
		)
			throw new Error(`invalid attempt: ${identity}`);
		seen.add(identity);
		const trace = row.disturbance_trace;
		if (
			row.focus_disturbance !== false ||
			row.pointer_disturbance !== false ||
			!Number.isFinite(trace?.max_cursor_px) ||
			trace.max_cursor_px > 2 ||
			trace.activations?.length !== 0
		)
			throw new Error(`unverified disturbance: ${identity}`);
		const owned = row.started_processes?.[0];
		const ended = row.cleanup?.processes?.[0];
		if (
			row.cleanup?.error !== null ||
			row.cleanup.leftover?.length !== 0 ||
			row.cleanup.closed?.length !== 1 ||
			row.started_processes?.length !== 1 ||
			row.cleanup.processes?.length !== 1 ||
			owned.bundle !== "com.apple.systempreferences" ||
			!Number.isInteger(owned.pid) ||
			owned.pid < 1 ||
			pids.has(owned.pid) ||
			ended.pid !== owned.pid ||
			ended.bundle !== owned.bundle ||
			ended.verified !== true ||
			(row.unexpected_windows?.length && row.cleanup.unexpected_absence_verified !== true)
		)
			throw new Error(`unverified window/process cleanup: ${identity}`);
		pids.add(owned.pid);
		if (
			row.pass &&
			(typeof row.oracle_expected_version !== "string" ||
				!row.oracle_expected_version ||
				typeof row.oracle_text !== "string" ||
				!row.oracle_text.includes(row.oracle_expected_version))
		)
			throw new Error(`unverified version oracle: ${identity}`);
		counts[row.route].n++;
		counts[row.route].pass += Number(row.pass);
	}
	return { counts, verified_distinct_process_terminations: pids.size, zero_recorded_disturbance: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const file = process.argv[2];
	if (!file) throw new Error("usage: verify-settings-cohort <raw>");
	const bytes = readFileSync(file);
	const verified = verifySettingsCohort(JSON.parse(bytes.toString("utf8")));
	process.stdout.write(
		`${JSON.stringify({ file, sha256: createHash("sha256").update(bytes).digest("hex"), ...verified })}\n`,
	);
}
