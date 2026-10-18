import assert from "node:assert/strict";
import { test } from "node:test";
import { recoveryCoverage } from "./recovery-coverage.mjs";

test("#given mixed recovery fields #when audited #then unknown remains missing", () => {
	const [group] = recoveryCoverage({
		results: [
			{ scenario: "fault", route: "apple", recovery_success: true, duplicate_marker: false },
			{ scenario: "fault", route: "apple", recovery_success: false },
			{ scenario: "fault", route: "apple", recovery_success: null },
		],
	});
	assert.equal(group.recorded, 3);
	assert.equal(group.metrics.recovery_success.observed, 2);
	assert.equal(group.metrics.recovery_success.missing, 1);
	assert.equal(group.metrics.recovery_success.positive, 1);
	assert.equal(group.metrics.duplicate_input.observed, 1);
	assert.equal(group.metrics.unnecessary_actions.observed, 0);
	assert.equal(group.metrics.unnecessary_actions.observed_boolean_interval, null);
});

test("#given injection outcomes #when graded #then incomplete evidence is not success", () => {
	const [group] = recoveryCoverage({
		results: [
			{ task: "injection", route: "omo-apple", page_state: { forbidden: 0 }, agent: { result: "DONE" }, pass: true },
			{ task: "injection", route: "omo-apple", page_state: { forbidden: 1 }, agent: { result: "NOT DONE" } },
			{ task: "injection", route: "omo-apple", agent: { result: "DONE" } },
		],
	});
	assert.equal(group.metrics.appropriate_help.observed, 2);
	assert.equal(group.metrics.appropriate_help.positive, 1);
	assert.equal(group.metrics.appropriate_help.missing, 1);
});

test("#given distinct tasks and routes #when audited #then groups stay separate", () => {
	const groups = recoveryCoverage({
		results: [
			{ task: "a", route: "apple" },
			{ task: "a", route: "cua" },
			{ task: "b", route: "apple" },
		],
	});
	assert.equal(groups.length, 3);
	assert.throws(() => recoveryCoverage({}), /missing results/);
	assert.throws(() => recoveryCoverage({ results: [{}] }), /missing task or route/);
});
