import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCancellation } from "./cancellation-analysis.mjs";

test("#given one observed and one missing attempt #when summarizing #then retain missing observations and all-attempt denominators", () => {
	const result = summarizeCancellation([
		{
			evidence: {
				responsive: true,
				cleanup_before: 1,
				cleanup: true,
				cancel: { epoch_ms: 10 },
				response_epoch_ms: 25,
				events: [{ type: "change", value: "cancel mutation marker ".repeat(512) }],
			},
		},
		{},
	]);
	assert.equal(result.n, 2);
	assert.equal(result.responsive.wilson.rate, 0.5);
	assert.equal(result.responsiveness_observations, 1);
	assert.equal(result.verified_cleanup.count, 1);
	assert.equal(result.full_input_before_cancel, 1);
	assert.deepEqual(result.cancel_response_ms, { observed: 1, missing: 1, median: 15, p95: 15 });
	assert.equal(result.input_interruption_verdict, "INCONCLUSIVE");
});

test("#given a same-length corrupted input #when summarizing #then length alone cannot establish exact input", () => {
	const result = summarizeCancellation([{ evidence: { events: [{ type: "change", value: "x".repeat(11776) }] } }]);
	assert.equal(result.full_input_before_cancel, 0);
});
