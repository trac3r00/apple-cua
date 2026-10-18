import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_HEADING } from "../bench-v2/fixture.mjs";
import { verifyHeadingCohort } from "./verify-heading-cohort.mjs";

function cohort() {
	return {
		finished_at: "2026-10-11",
		runs: 30,
		results: Array.from({ length: 30 }, (_, index) =>
			["apple", "cua"].map((route) => ({
				route,
				iteration: index + 1,
				scenario: "safari-heading",
				pass: route === "apple",
				baseline_nonce: "setup",
				oracle_state: route === "apple" ? { nonce: "new", heading: PAGE_HEADING } : undefined,
				focus_disturbance: false,
				pointer_disturbance: false,
				disturbance_trace: { max_cursor_px: 0, activations: [] },
				cleanup: { error: null, leftover: [], closed: ["owned"] },
			})),
		).flat(),
	};
}

test("#given thirty paired heading attempts #when verifying #then counts retained failures and closures", () => {
	assert.deepEqual(verifyHeadingCohort(cohort()).counts, {
		apple: { attempts: 30, completed: 30 },
		cua: { attempts: 30, completed: 0 },
	});
});

test("#given an extension stage #when verifying #then accepts only its declared pairing range", () => {
	const report = cohort();
	report.start_iteration = 31;
	for (const row of report.results) row.iteration += 30;
	assert.equal(verifyHeadingCohort(report).verified_closures, 60);
	report.results[0].iteration = 1;
	assert.throws(() => verifyHeadingCohort(report));
});

test("#given missing or inconsistent evidence #when verifying #then rejects the cohort", () => {
	for (const mutate of [
		(row) => {
			row.oracle_state.nonce = row.baseline_nonce;
		},
		(row) => {
			row.disturbance_trace.max_cursor_px = undefined;
		},
		(row) => {
			row.cleanup.leftover.push("unknown");
		},
		(row) => {
			row.not_started = true;
		},
		(row) => {
			row.unexpected_windows = ["unknown"];
		},
	]) {
		const report = cohort();
		mutate(report.results[0]);
		assert.throws(() => verifyHeadingCohort(report));
	}
	const duplicate = cohort();
	duplicate.results[1] = duplicate.results[0];
	assert.throws(() => verifyHeadingCohort(duplicate));
});
