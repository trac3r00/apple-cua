import assert from "node:assert/strict";
import test from "node:test";
import { verifyBrowserCohort } from "./verify-browser-cohort.mjs";

function cohort() {
	return {
		finished_at: "2026-10-11",
		runs: 30,
		scenarios: ["safari-form"],
		results: Array.from({ length: 60 }, (_, index) => ({
			route: index % 2 ? "cua" : "apple",
			iteration: Math.floor(index / 2) + 1,
			scenario: "safari-form",
			pass: true,
			e2e_seconds: 1,
			baseline_nonce: "owned",
			page_state: { nonce: "owned", field: "Bench-v2 marker 8c52" },
			owned_windows: [{ number: index + 1 }],
			cleanup: { error: null, leftover: [], closed: ["owned"] },
			focus_disturbance: false,
			pointer_disturbance: false,
			disturbance_trace: { max_cursor_px: 0, activations: [] },
		})),
	};
}

test("#given paired browser evidence #when verifying #then counts both routes and closures", () => {
	assert.equal(verifyBrowserCohort(cohort()).verified_attempts, 60);
});

test("#given a one-pair pilot #when explicitly validating pilot evidence #then verifies it without satisfying the scored minimum", () => {
	const report = cohort();
	report.runs = 1;
	report.results = report.results.slice(0, 2);
	assert.throws(() => verifyBrowserCohort(report));
	assert.equal(verifyBrowserCohort(report, 1).verified_attempts, 2);
	assert.throws(() => verifyBrowserCohort(report, 0));
});

test("#given a retained task failure #when verifying #then reports its identity without dropping the denominator", () => {
	const report = cohort();
	report.results[0].pass = false;
	report.results[0].error = "E_REFUSED";
	const verified = verifyBrowserCohort(report);
	assert.equal(verified.counts["safari-form"].apple.n, 30);
	assert.deepEqual(verified.failed_attempts, [
		{
			scenario: "safari-form",
			route: "apple",
			iteration: 1,
			error: "E_REFUSED",
			page_state: report.results[0].page_state,
			false_success: null,
		},
	]);
});

test("#given a declared extension stage #when verifying #then accepts only that iteration range", () => {
	const report = cohort();
	report.start_iteration = 31;
	for (const row of report.results) row.iteration += 30;
	assert.equal(verifyBrowserCohort(report).verified_attempts, 60);
	report.results[0].iteration = 1;
	assert.throws(() => verifyBrowserCohort(report));
});

test("#given cross-app closure claims without document and surface read-back #when verifying #then rejects incomplete evidence", () => {
	const report = cohort();
	report.scenarios = ["clipboard-cross-app"];
	for (const row of report.results) {
		row.scenario = "clipboard-cross-app";
		row.owned_windows.push({ owner_bundle: "com.apple.TextEdit" });
		row.cleanup.closed.push("owned-text");
		row.cleanup.fixture_removed = true;
	}
	assert.throws(() => verifyBrowserCohort(report));
	for (const row of report.results)
		row.owned_windows[1].closure_readback = { document_count: 0, ax_live: false, on_screen: false };
	assert.equal(verifyBrowserCohort(report).verified_attempts, 60);
});

test("#given weak browser evidence #when verifying #then refuses unsupported completion", () => {
	for (const mutate of [
		(row) => {
			row.page_state.nonce = "other";
		},
		(row) => {
			row.cleanup.closed = [];
		},
		(row) => {
			row.disturbance_trace.max_cursor_px = undefined;
		},
		(row) => {
			row.not_started = true;
		},
	]) {
		const report = cohort();
		mutate(report.results[0]);
		assert.throws(() => verifyBrowserCohort(report));
	}
	const duplicate = cohort();
	duplicate.results[1] = duplicate.results[0];
	assert.throws(() => verifyBrowserCohort(duplicate));
});
