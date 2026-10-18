import assert from "node:assert/strict";
import test from "node:test";
import { fixtureSmokeGate, matrixGate, policySmokeGate } from "./matrix-gate.mjs";

test("#given a terminal policy pilot #when cleanup is verified #then losing attempts can advance", () => {
	const report = {
		runs: 1,
		finished_at: "2026-10-10T00:00:00Z",
		results: [{ iteration: 1, route: "apple", scenario: "policy-denied", pass: false }],
		cleanup: { verified: true, leftover_documents: 0, fixture_removed: true },
	};
	assert.equal(policySmokeGate(report).ready, true);
	for (const mutation of ["partial", "duplicate", "running", "cleanup", "leftover", "removal", "route"]) {
		const bad = structuredClone(report);
		if (mutation === "partial") bad.results = [];
		if (mutation === "duplicate") bad.results.push(bad.results[0]);
		if (mutation === "running") bad.finished_at = undefined;
		if (mutation === "cleanup") bad.cleanup.verified = false;
		if (mutation === "leftover") bad.cleanup.leftover_documents = undefined;
		if (mutation === "removal") bad.cleanup.fixture_removed = false;
		if (mutation === "route") bad.results[0].route = "cua";
		assert.equal(policySmokeGate(bad).ready, false);
	}
});

const options = { runs: 1, routes: ["a", "b"], tasks: ["task"] };

test("#given a restart-interrupted slot #when absence is independently verified #then retain it as a terminal failure", () => {
	const interrupted = report();
	const row = interrupted.results[0];
	row.interrupted = true;
	row.url = "http://127.0.0.1/page?attempt=restart";
	row.cleanup = undefined;
	const evidence = {
		url: row.url,
		iteration: row.iteration,
		task: row.task,
		route: row.route,
		verified_at: "2026-10-10T02:45:13.373Z",
		runtime_restart: true,
		terminal_failure: true,
		old_agent_process_absent: true,
		registry_sessions: 0,
		matching_fixture_tabs: 0,
	};
	assert.equal(matrixGate(interrupted, { ...options, cleanupRecoveries: [evidence] }).ready, true);
	assert.equal(row.interrupted, true);
	assert.equal(row.pass, false);
	for (const key of ["old_agent_process_absent", "registry_sessions", "matching_fixture_tabs", "terminal_failure"]) {
		const missing = structuredClone(evidence);
		missing[key] = undefined;
		assert.equal(matrixGate(interrupted, { ...options, cleanupRecoveries: [missing] }).ready, false);
	}
	assert.equal(matrixGate(interrupted, options).ready, false);
	const serverCrash = {
		...evidence,
		runtime_restart: false,
		harness_process_exit: true,
		error_code: "ERR_HTTP_HEADERS_SENT",
	};
	assert.equal(matrixGate(interrupted, { ...options, cleanupRecoveries: [serverCrash] }).ready, true);
	assert.equal(
		matrixGate(interrupted, { ...options, cleanupRecoveries: [{ ...serverCrash, error_code: "unknown" }] }).ready,
		false,
	);
	row.pass = true;
	assert.equal(matrixGate(interrupted, { ...options, cleanupRecoveries: [evidence] }).ready, false);
});

test("#given a lost registry session #when exact fixture absence is independently recorded #then recovery permits handoff", () => {
	const recovered = report();
	const row = recovered.results[0];
	row.url = "http://127.0.0.1/page?attempt=owned";
	row.managed_session = "owned";
	row.browser_instance = "browser";
	row.cleanup = { error: "BskRpcError: session is not registered" };
	const evidence = {
		url: row.url,
		managed_session: row.managed_session,
		browser_instance: row.browser_instance,
		verified_at: "2026-10-10T01:42:54.389Z",
		registry_session_absent: true,
		matching_fixture_tabs: 0,
	};
	const settings = { ...options, cleanupRecoveries: [evidence] };
	assert.equal(matrixGate(recovered, settings).ready, true);
	assert.equal(matrixGate(recovered, options).ready, false);
	for (const key of [
		"url",
		"managed_session",
		"browser_instance",
		"verified_at",
		"registry_session_absent",
		"matching_fixture_tabs",
	]) {
		const incomplete = structuredClone(evidence);
		incomplete[key] = undefined;
		assert.equal(matrixGate(recovered, { ...options, cleanupRecoveries: [incomplete] }).ready, false);
	}
	row.cleanup.error = "permission_denied";
	assert.equal(matrixGate(recovered, settings).ready, false);
});

test("#given terminal text-fault smoke #when releasing offline analysis #then losing rows pass but missing cleanup blocks", () => {
	const report = {
		runs: 1,
		finished_at: "2026-10-09T00:00:00Z",
		results: ["stale-token-recovery", "textedit-window-reopened", "server-killed"].flatMap((scenario) =>
			["apple", "cua"].map((route) => ({
				scenario,
				route,
				iteration: 1,
				pass: false,
				cleanup: { attempted: true, leftover: [] },
			})),
		),
	};
	assert.equal(fixtureSmokeGate(report, "text-faults").ready, true);
	for (const mutation of ["missing", "nonempty", "unattempted", "duplicate", "partial", "running"]) {
		const bad = structuredClone(report);
		if (mutation === "missing") bad.results[0].cleanup.leftover = undefined;
		if (mutation === "nonempty") bad.results[0].cleanup.leftover.push("owned window");
		if (mutation === "unattempted") bad.results[0].cleanup.attempted = false;
		if (mutation === "duplicate") bad.results[1] = bad.results[0];
		if (mutation === "partial") bad.results.pop();
		if (mutation === "running") bad.finished_at = undefined;
		assert.equal(fixtureSmokeGate(bad, "text-faults").ready, false);
	}
});

const report = () => ({
	runs: 1,
	routes: ["a", "b"],
	summary: {},
	results: ["a", "b"].map((route) => ({
		iteration: 1,
		route,
		task: "task",
		pass: false,
		interrupted: false,
		cleanup: { managed_session_stopped: true },
	})),
});

for (const kind of ["remaining", "cancellation"]) {
	const leftoverKey = kind === "remaining" ? "leftover" : "leftover_windows";
	const fixtureReport = () => ({
		runs: 1,
		finished_at: "2026-10-09T00:00:00Z",
		results: (kind === "remaining"
			? ["safari-heading", "settings-version", "two-apps-one-task"]
			: ["cancellation"]
		).flatMap((scenario) =>
			["apple", "cua"].map((route) => ({
				scenario,
				route,
				iteration: 1,
				pass: false,
				trial_completed: true,
				cleanup: { [leftoverKey]: [], target_file_removed: true },
			})),
		),
	});
	test(`#given ${kind} smoke records #when gating #then losses pass but incomplete cleanup blocks`, () => {
		assert.equal(fixtureSmokeGate(fixtureReport(), kind).ready, true);
		for (const badValue of [undefined, null, ["owned window"]]) {
			const bad = fixtureReport();
			bad.results[0].cleanup[leftoverKey] = badValue;
			assert.equal(fixtureSmokeGate(bad, kind).ready, false);
		}
		for (const mutation of ["error", "duplicate", "partial", "unfinished"]) {
			const bad = fixtureReport();
			if (mutation === "error") bad.results[0].cleanup.error = "cleanup failed";
			if (mutation === "duplicate") bad.results[1] = bad.results[0];
			if (mutation === "partial") bad.results.pop();
			if (mutation === "unfinished") bad.finished_at = undefined;
			assert.equal(fixtureSmokeGate(bad, kind).ready, false);
		}
		if (kind === "cancellation") {
			const bad = fixtureReport();
			bad.results[0].trial_completed = false;
			assert.equal(fixtureSmokeGate(bad, kind).ready, false);
			bad.results[0].trial_completed = true;
			bad.results[0].cleanup.target_file_removed = undefined;
			assert.equal(fixtureSmokeGate(bad, kind).ready, false);
		}
	});
}

test("#given complete losing attempts #when checking the handoff #then losses do not block sequential QA", () => {
	assert.equal(matrixGate(report(), options).ready, true);
});
test("#given missing or duplicate slots #when checking the handoff #then measurement cannot advance", () => {
	const missing = report();
	missing.results.pop();
	assert.equal(matrixGate(missing, options).ready, false);
	const duplicate = report();
	duplicate.results[1] = duplicate.results[0];
	assert.equal(matrixGate(duplicate, options).ready, false);
});
test("#given unfinished work or unverified cleanup #when checking the handoff #then it stops", () => {
	const interrupted = report();
	interrupted.results[0].interrupted = true;
	assert.equal(matrixGate(interrupted, options).ready, false);
	const cleanup = report();
	cleanup.results[0].cleanup.error = "stop failed";
	assert.equal(matrixGate(cleanup, options).ready, false);
	const running = report();
	running.summary = undefined;
	assert.equal(matrixGate(running, options).ready, false);
});
