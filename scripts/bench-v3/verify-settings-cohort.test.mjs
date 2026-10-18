import assert from "node:assert/strict";
import test from "node:test";
import { verifySettingsCohort } from "./verify-settings-cohort.mjs";

function cohort() {
	return {
		finished_at: "2026-10-11",
		runs: 30,
		results: Array.from({ length: 60 }, (_, index) => {
			const owned = { pid: index + 1, bundle: "com.apple.systempreferences" };
			return {
				route: index % 2 ? "cua" : "apple",
				iteration: Math.floor(index / 2) + 1,
				scenario: "settings-version",
				pass: true,
				e2e_seconds: 1,
				oracle_expected_version: "26.7",
				oracle_text: "Version 26.7",
				started_processes: [owned],
				cleanup: { error: null, leftover: [], closed: ["owned"], processes: [{ ...owned, verified: true }] },
				focus_disturbance: false,
				pointer_disturbance: false,
				disturbance_trace: { max_cursor_px: 0, activations: [] },
			};
		}),
	};
}

test("#given complete Settings evidence #when verifying #then counts pairs and independent process closures", () => {
	assert.equal(verifySettingsCohort(cohort()).verified_distinct_process_terminations, 60);
});

test("#given a driver failure before the version read #when verifying #then retains the failed attempt", () => {
	const report = cohort();
	const row = report.results[0];
	row.pass = false;
	row.error = "tool refused input";
	row.oracle_expected_version = undefined;
	row.oracle_text = undefined;
	assert.equal(verifySettingsCohort(report).counts.apple.pass, 29);
	assert.equal(verifySettingsCohort(report).counts.apple.n, 30);
});

test("#given weak oracle or cleanup evidence #when verifying #then refuses the cohort", () => {
	for (const mutate of [
		(row) => {
			row.oracle_expected_version = undefined;
		},
		(row) => {
			row.cleanup.processes[0].verified = false;
		},
		(row) => {
			row.cleanup.processes[0].pid = 99;
		},
		(row) => {
			row.disturbance_trace.max_cursor_px = undefined;
		},
	]) {
		const report = cohort();
		mutate(report.results[0]);
		assert.throws(() => verifySettingsCohort(report));
	}
});
