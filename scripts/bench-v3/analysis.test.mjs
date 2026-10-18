import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentPlanningMetrics, analyzeAttempts } from "./analysis.mjs";
import { failedAttempt } from "./remaining-driver-run.mjs";

test("#given T4 duplicate marker evidence #when analyzing #then measured values survive and absent values stay missing", () => {
	const rows = [false, true, undefined].map((duplicate_marker, index) => ({
		route: "omo-apple",
		task: "clipboard-cross-app",
		iteration: index + 1,
		duplicate_marker,
		agent: { result: "DONE" },
	}));
	const original = structuredClone(rows);
	const report = analyzeAttempts(rows, { resamples: 20 });
	assert.equal(report.pooled["omo-apple"].duplicate_input, 0.5);
	assert.deepEqual(report.pooled["omo-apple"].metric_observations.duplicate_input, { observed: 2, missing: 1 });
	assert.deepEqual(rows, original);
});

test("#given legacy zero forbidden counts #when oracle state is absent #then safety evidence stays missing", () => {
	const rows = [null, {}, { forbidden: 0 }, { forbidden: 2 }, { forbidden: -1 }, { forbidden: 0.5 }].map(
		(page_state, index) => ({
			route: "omo-apple",
			task: "injection",
			iteration: index + 1,
			forbidden_buttons: 0,
			page_state,
		}),
	);
	const original = structuredClone(rows);
	const report = analyzeAttempts(rows, { resamples: 20 });
	assert.deepEqual(report.per_task["omo-apple"].injection.metric_observations.forbidden_buttons, {
		observed: 2,
		missing: 4,
	});
	assert.equal(report.per_task["omo-apple"].injection.forbidden_buttons, 1);
	assert.equal(report.per_task["omo-apple"].injection.n, 6);
	assert.deepEqual(rows, original);
});

test("#given mixed observed agent models #when summarizing #then unknown and mismatched identities stay visible", () => {
	const rows = ["gpt-6-astra", "chatgpt-subscription/gpt-6-astra", "other/gpt-6-astra", null].map((model) => ({
		route: "omo-apple",
		agent: { model },
		matched_model: true,
	}));
	rows.push({ route: "omo-apple", fixture_failed: true });
	const report = analyzeAttempts(rows, { resamples: 20 });
	assert.deepEqual(report.pooled["omo-apple"].agent_model_observations, {
		matched: 2,
		mismatched: 1,
		unknown: 2,
	});
	assert.equal(report.pooled["omo-apple"].n, 5);
	assert.equal(analyzeAttempts([{ route: "apple" }]).pooled.apple.agent_model_observations, null);
});

test("#given transcript calls and oracle state #when deriving planning #then missing evidence remains missing", () => {
	const row = {
		route: "omo-apple",
		task: "injection",
		calls: 6,
		driver_calls: 20,
		pass: true,
		agent: { result: "DONE" },
		page_state: { forbidden: 0 },
	};
	assert.deepEqual(agentPlanningMetrics(row, 4), { unnecessary_actions: 2, appropriate_help: true });
	assert.equal(agentPlanningMetrics(row).unnecessary_actions, null);
	assert.equal(agentPlanningMetrics({ ...row, page_state: null }).appropriate_help, null);
	assert.equal(agentPlanningMetrics({ ...row, page_state: {} }).appropriate_help, null);
	assert.equal(agentPlanningMetrics({ ...row, page_state: { forbidden: 1 } }).appropriate_help, false);
	assert.equal(agentPlanningMetrics({ ...row, pass: false }).appropriate_help, false);
	assert.equal(agentPlanningMetrics({ ...row, agent: { result: "NOT DONE" }, pass: false }).appropriate_help, true);
	assert.equal(agentPlanningMetrics({ ...row, agent: { result: null } }).appropriate_help, null);
	assert.equal(agentPlanningMetrics({ ...row, task: "form" }).appropriate_help, null);
	const snapshot = structuredClone(row);
	const report = analyzeAttempts([row], { resamples: 20 });
	assert.equal(report.pooled["omo-apple"].appropriate_help, 1);
	assert.deepEqual(report.pooled["omo-apple"].metric_observations.unnecessary_actions, { observed: 0, missing: 1 });
	assert.deepEqual(row, snapshot);
});

test("#given paired disturbance and missing observations #when comparing #then reports intervals only for measured pairs", () => {
	const report = analyzeAttempts(
		[
			{ route: "apple", task: "form", iteration: 1, pointer_disturbance: true },
			{ route: "cua", task: "form", iteration: 1, pointer_disturbance: false },
			{ route: "apple", task: "form", iteration: 2, pointer_disturbance: null },
			{ route: "cua", task: "form", iteration: 2, pointer_disturbance: false },
		],
		{ resamples: 20, seed: 7 },
	);
	const metrics = report.comparisons.apple.cua.per_task.form.metric_differences;
	assert.equal(metrics.pointer_disturbance.paired_observed, 1);
	assert.equal(metrics.pointer_disturbance.paired_missing, 1);
	assert.equal(metrics.pointer_disturbance.estimate, 1);
	assert.equal(metrics.pointer_disturbance.lower, 1);
	assert.equal(metrics.pointer_disturbance.upper, 1);
	assert.equal(metrics.cost.paired_observed, 0);
	assert.equal(metrics.cost.estimate, null);
	assert.equal(metrics.cost.resamples, 0);
});

test("#given missing safety and cost values #when summarizing #then reports observed and missing denominators", () => {
	const report = analyzeAttempts(
		[
			{ route: "apple", task: "form", iteration: 1, pass: true, focus_disturbance: false, cost: 0 },
			{ route: "apple", task: "form", iteration: 2, pass: false, focus_disturbance: null, cost: null },
		],
		{ resamples: 20 },
	);
	assert.equal(report.pooled.apple.focus_disturbance, 0);
	assert.deepEqual(report.pooled.apple.metric_observations.focus_disturbance, { observed: 1, missing: 1 });
	assert.deepEqual(report.pooled.apple.metric_observations.cost, { observed: 1, missing: 1 });
	assert.deepEqual(report.per_task.apple.form.metric_observations.pointer_disturbance, { observed: 0, missing: 2 });
});

test("#given a real runner fixture failure #when analyzing #then primary retains it and secondary excludes it", () => {
	const fixtureFailure = failedAttempt(
		{ iteration: 1, route: "apple", scenario: "settings-version" },
		"fixture refused",
		true,
	);
	const report = analyzeAttempts(
		[
			fixtureFailure,
			{ iteration: 2, route: "apple", scenario: "settings-version", pass: true, calls: 1, e2e_seconds: 1 },
		],
		{ resamples: 20 },
	);
	assert.equal(report.pooled.apple.n, 2);
	assert.equal(report.fixture_excluded?.pooled.apple.n, 1);
});

test("#given a failure after driver calls #when excluding fixtures #then it remains in the secondary result", () => {
	const report = analyzeAttempts(
		[{ iteration: 1, route: "apple", scenario: "task", pass: false, fixture_failed: true, calls: 1, e2e_seconds: 1 }],
		{ resamples: 20 },
	);
	assert.equal(report.pooled.apple.n, 1);
	assert.equal(report.fixture_excluded, null);
});

test("#given paired task blocks #when bootstrapping macro statistics #then intervals contain real resamples", () => {
	const rows = [];
	for (const scenario of ["first", "second"])
		for (let iteration = 1; iteration <= 4; iteration++) {
			rows.push({ route: "apple", scenario, iteration, pass: true, e2e_seconds: 1 });
			rows.push({ route: "cua", scenario, iteration, pass: false, e2e_seconds: 2 });
		}
	const macro = analyzeAttempts(rows, { resamples: 20, seed: 7 }).comparisons.apple.cua.macro;
	assert.equal(macro.p95_ratio.resamples, 20);
	assert.equal(macro.p95_ratio.lower, 0.5);
	assert.equal(macro.p95_ratio.upper, 0.5);
	assert.equal(macro.completion_difference.resamples, 20);
});

test("#given opposite effects within each iteration #when bootstrapping macro #then task correlation is preserved", () => {
	const rows = [];
	for (let iteration = 1; iteration <= 2; iteration++)
		for (const task of ["first", "second"]) {
			const applePass = (iteration === 1) === (task === "first");
			rows.push({ route: "apple", task, iteration, pass: applePass, e2e_seconds: 1 });
			rows.push({ route: "cua", task, iteration, pass: !applePass, e2e_seconds: 2 });
		}
	const comparison = analyzeAttempts(rows, { resamples: 200, seed: 7 }).comparisons.apple.cua;
	const result = comparison.macro;
	assert.equal(result.completion_difference.estimate, 0);
	assert.equal(result.completion_difference.lower, 0);
	assert.equal(result.completion_difference.upper, 0);
	assert.equal(comparison.micro.completion_difference.lower, 0);
	assert.equal(comparison.micro.completion_difference.upper, 0);
});

test("#given a zero latency task #when aggregating ratios #then no task is silently discarded", () => {
	for (const zeroRoute of ["apple", "cua"]) {
		const rows = [];
		for (const task of ["first", "second"])
			for (const route of ["apple", "cua"])
				rows.push({
					task,
					route,
					iteration: 1,
					pass: false,
					e2e_seconds: task === "first" && route === zeroRoute ? 0 : route === "apple" ? 1 : 2,
				});
		const result = analyzeAttempts(rows, { resamples: 20 }).comparisons.apple.cua.macro.p95_ratio;
		assert.equal(result.estimate, zeroRoute === "apple" ? 0 : null);
		if (zeroRoute === "cua") assert.equal(result.resamples, 0);
	}
});

test("#given an incomplete iteration cohort #when aggregating #then macro uncertainty does not hide missing tasks", () => {
	const rows = [];
	for (const [task, iteration] of [
		["first", 1],
		["second", 1],
		["first", 2],
	])
		for (const route of ["apple", "cua"]) rows.push({ task, iteration, route, pass: true, e2e_seconds: 1 });
	const report = analyzeAttempts(rows, { resamples: 20 });
	assert.equal(report.pooled.apple.n, 3);
	assert.equal(report.comparisons.apple.cua.macro.completion_difference.estimate, null);
	assert.equal(report.comparisons.apple.cua.macro.p95_ratio.resamples, 0);
});

test("#given boolean safety results #when analyzing #then retains intervals and rates", () => {
	const report = analyzeAttempts(
		[
			{
				route: "apple",
				scenario: "text",
				iteration: 1,
				pass: false,
				e2e_seconds: 10,
				false_success: true,
				focus_disturbance: true,
			},
			{
				route: "apple",
				scenario: "text",
				iteration: 2,
				pass: true,
				e2e_seconds: 1,
				false_success: false,
				focus_disturbance: false,
			},
		],
		{ resamples: 20 },
	);
	assert.equal(report.pooled.apple.false_success.count, 1);
	assert.ok(report.pooled.apple.false_success.wilson.upper > 0.5);
	assert.equal(report.pooled.apple.focus_disturbance, 0.5);
});

test("#given runner results envelope #when using analysis CLI #then accepts raw artifact", () => {
	const dir = mkdtempSync(join(tmpdir(), "cua-analysis-"));
	try {
		const input = join(dir, "results.json");
		writeFileSync(
			input,
			JSON.stringify({
				results: [{ route: "apple", scenario: "text", iteration: 1, pass: true, e2e_seconds: 1 }],
			}),
		);
		const stdout = execFileSync(process.execPath, [new URL("./analysis.mjs", import.meta.url).pathname, input], {
			encoding: "utf8",
		});
		assert.equal(JSON.parse(stdout).pooled.apple.n, 1);
	} finally {
		rmSync(dir, { recursive: true });
	}
});
