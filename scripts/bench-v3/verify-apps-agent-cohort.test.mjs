import assert from "node:assert/strict";
import test from "node:test";
import { TARGET } from "../bench-v2/fixture.mjs";
import { parseAgentTranscript } from "./agents.mjs";
import { SAFARI_FIXTURE_POLICY, appsAgentOracle } from "./apps-agent-run.mjs";
import { parseVerifierArgs, verifyAppsAgentCohort } from "./verify-apps-agent-cohort.mjs";

function cohort(runs = 30, startIteration = 1) {
	const raw = `${JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "RESULT: DONE" }] },
	})}\n`;
	const path = "/tmp/cua-bench/apps-agent-t4-abc123";
	const sources = [
		"apps-agent-run.mjs",
		"agents.mjs",
		"pages.mjs",
		"ax-document-identity.swift",
		"ax-window-inventory.swift",
		"window-surface-event.swift",
		"window-surface-event.mjs",
		"disturbance.swift",
		"disturbance.mjs",
	];
	const report = {
		schema: "bench-v3-agent-apps",
		runs,
		model: "gpt-6-astra",
		reasoning: "high",
		timeout_seconds: 300,
		routes: ["omo-apple", "omo-native"],
		tasks: ["clipboard-cross-app"],
		finished_at: "2026-10-11T00:00:00Z",
		fixture_policy: SAFARI_FIXTURE_POLICY,
		fixture_provenance: {
			revision: SAFARI_FIXTURE_POLICY,
			source_hashes: Object.fromEntries(sources.map((name) => [`scripts/bench-v3/${name}`, "a".repeat(64)])),
		},
		fixture_directory: { path, dev: 1, ino: 2, uid: 501 },
		results: [],
	};
	if (startIteration !== 1) report.start_iteration = startIteration;
	for (let iteration = startIteration; iteration < startIteration + runs; iteration++)
		for (const route of report.routes) {
			const url = `http://127.0.0.1:12345/page?kind=form&attempt=${iteration}-${route}`;
			const owned = [
				{ pid: 42, number: 7, bundle: "com.apple.TextEdit", path: `${path}/document.txt` },
				{ pid: 42, number: 8, bundle: "com.apple.TextEdit", path: `${path}/other.txt` },
				{ pid: 43, number: 9, bundle: "com.apple.Safari", url },
			];
			const files = {
				source: TARGET,
				source_document: TARGET,
				control: "other document unchanged",
				control_document: "other document unchanged",
				saved: null,
			};
			const state = { page: url, nonce: "owned-nonce", ready: true, field: TARGET };
			report.results.push({
				task: "clipboard-cross-app",
				route,
				iteration,
				url,
				pass: true,
				false_success: false,
				fixture_started: true,
				fixture_failed: false,
				interrupted: false,
				e2e_seconds: 1,
				fixture_and_cleanup_seconds: 2,
				result: "DONE",
				agent: { ...parseAgentTranscript(route, raw), elapsedSeconds: 1, stdoutPath: "stdout", driverCalls: null },
				calls: 0,
				driver_calls: null,
				tokens: null,
				cached_tokens: null,
				cost: null,
				matched_model: null,
				oracle_inputs: { state, files, baseline_nonce: "owned-nonce" },
				oracle: { ...appsAgentOracle("clipboard-cross-app", state, files), page_nonce: true },
				owned_fixtures: owned,
				closure_evidence: owned.map((item) => {
					const document = {
						pid: item.pid,
						bundle: item.bundle,
						status: "no_match",
						matched_window_ids: [],
						unknown_document_windows: 0,
					};
					return {
						...item,
						closed: true,
						modelCount: 0,
						document: item.path ? document : null,
						inventory: { pid: item.pid, bundle: item.bundle, ax_window_ids: [] },
						windows: [{ pid: item.pid, number: item.number, onScreen: false }],
					};
				}),
				cleanup: {
					attempted: true,
					leftover: [],
					file_readback: ["document.txt", "other.txt", "saved-from-sheet.txt"].map((name) => ({
						path: `${path}/${name}`,
						exists: false,
					})),
				},
				cleanup_disturbance: { focus: false, pointer: false },
				unintended_files: [],
				unintended_changes: false,
				duplicate_marker: false,
				focus_disturbance: false,
				pointer_disturbance: false,
				disturbance_trace: {
					max_cursor_px: 0,
					max_appkit_cursor_px: 0,
					end_cursor_px: 0,
					front_start: "com.apple.Terminal",
					front_end: "com.apple.Terminal",
					activations: [],
					cursor_samples: 20,
				},
			});
		}
	return { report, read: () => raw };
}

test("#given measured paired fixtures #when verifying #then preserves missing model and cost without inventing them", () => {
	const { report, read } = cohort();
	const result = verifyAppsAgentCohort(report, 30, read);
	assert.equal(result.verified_full_fixture_cohort, true);
	assert.equal(result.primary_denominator, 60);
	assert.equal(result.attempts[0].missingness.model, true);
});

test("#given canonical macOS temporary paths #when verifying #then accepts exact owned provenance without treating the alias as foreign", () => {
	const { report, read } = cohort();
	const old = report.fixture_directory.path;
	report.fixture_directory.path = `/private${old}`;
	for (const row of report.results) {
		for (const owned of [...row.owned_fixtures, ...row.closure_evidence])
			if (owned.path) owned.path = `/private${owned.path}`;
		for (const file of row.cleanup.file_readback) file.path = `/private${file.path}`;
	}
	assert.equal(verifyAppsAgentCohort(report, 30, read).verified_full_fixture_cohort, true);
});

test("#given an empty leftover claim without file read-back #when verifying #then refuses unsupported cleanup", () => {
	const { report, read } = cohort();
	report.results[0].cleanup.file_readback = undefined;
	assert.throws(() => verifyAppsAgentCohort(report, 30, read), /unsupported completion/);
});

test("#given secondary cursor or duplicate-input evidence #when claiming safety #then never accepts a safe cohort", () => {
	for (const mutate of [
		(row) => {
			row.disturbance_trace.max_appkit_cursor_px = 3;
			row.pointer_disturbance = true;
		},
		(row) => {
			row.duplicate_marker = true;
		},
	]) {
		const { report, read } = cohort();
		mutate(report.results[0]);
		assert.equal(verifyAppsAgentCohort(report, 30, read).verified_full_safe_cohort, false);
	}
});

test("#given a fully measured losing DONE #when verifying #then retains denominator and actual false success", () => {
	const { report, read } = cohort();
	const row = report.results[0];
	row.oracle_inputs.state.field = "";
	row.oracle = { ...appsAgentOracle(row.task, row.oracle_inputs.state, row.oracle_inputs.files), page_nonce: true };
	row.pass = false;
	row.false_success = true;
	const result = verifyAppsAgentCohort(report, 30, read);
	assert.equal(result.verified_full_fixture_cohort, true);
	assert.equal(result.counts["omo-apple"].n, 30);
	assert.equal(result.failed_attempts.length, 1);
	assert.equal(result.failed_attempts[0].row, row);
});

test("#given missing setup and raw attempts #when analyzing #then counts every planned slot without claiming a full cohort", () => {
	const { report, read } = cohort();
	report.results.pop();
	const row = report.results[0];
	row.pass = false;
	row.false_success = true;
	row.oracle_inputs = undefined;
	row.agent = undefined;
	row.fixture_failed = true;
	const result = verifyAppsAgentCohort(report, 30, read);
	assert.equal(result.primary_denominator, 60);
	assert.equal(result.verified_full_fixture_cohort, false);
	assert.equal(result.failed_attempts.length, 2);
	assert.ok(result.failed_attempts[0].unsupported.some((reason) => reason.includes("offline recomputation")));
});

test("#given unsupported completion evidence #when verifying #then refuses rather than inferring absence or oracle inputs", () => {
	for (const mutate of [
		(row) => {
			row.oracle_inputs = undefined;
		},
		(row) => {
			row.closure_evidence[0].document.unknown_document_windows = 1;
		},
		(row) => {
			row.closure_evidence[2].url += "&wrong=1";
		},
		(row) => {
			row.owned_fixtures[0].path = "/tmp/cua-bench/document.txt";
		},
		(row) => {
			row.cleanup.leftover.push("document.txt");
		},
		(row) => {
			row.disturbance_trace = undefined;
		},
		(row) => {
			row.fixture_and_cleanup_seconds = 0;
		},
		(row) => {
			row.oracle_inputs.state.nonce = "foreign";
		},
		(row) => {
			row.oracle_inputs.state.page += "&wrong=1";
		},
		(row) => {
			row.false_success = true;
		},
		(row) => {
			row.calls = 1;
		},
	]) {
		const { report, read } = cohort();
		mutate(report.results[0]);
		assert.throws(() => verifyAppsAgentCohort(report, 30, read));
	}
});

test("#given duplicate pair or wrong selection #when verifying #then rejects ambiguous denominators", () => {
	const { report, read } = cohort();
	report.results[1] = report.results[0];
	assert.throws(() => verifyAppsAgentCohort(report, 30, read), /duplicate pairing/);
	report.tasks = ["textedit-save-sheet"];
	assert.throws(() => verifyAppsAgentCohort(report, 30, read), /T5 unsupported/);
});

test("#given explicit n1 pilot #when verifying #then labels exploratory evidence and refuses implicit small cohorts", () => {
	const { report, read } = cohort(1);
	assert.throws(() => verifyAppsAgentCohort(report, 30, read));
	assert.equal(verifyAppsAgentCohort(report, 1, read).evidence, "exploratory pilot");
	assert.deepEqual(parseVerifierArgs(["raw.json", "--pilot", "1"]), { file: "raw.json", requiredPairs: 1 });
	assert.throws(() => parseVerifierArgs(["raw.json", "--pilot"]));
	assert.throws(() => parseVerifierArgs(["raw.json", "--pilot", "0"]));
});

test("#given registered extension stages #when verifying #then use stage boundaries and retain missing denominators", () => {
	for (const startIteration of [31, 61]) {
		const { report, read } = cohort(30, startIteration);
		const full = verifyAppsAgentCohort(report, 30, read, startIteration);
		assert.equal(full.evidence, "registered extension stage");
		assert.equal(full.start_iteration, startIteration);
		assert.equal(full.verified_full_fixture_cohort, true);
		report.results.pop();
		const result = verifyAppsAgentCohort(report, 30, read, startIteration);
		assert.equal(result.primary_denominator, 60);
		assert.equal(result.counts["omo-native"].n, 30);
		assert.equal(result.verified_full_fixture_cohort, false);
		assert.deepEqual(
			result.failed_attempts.map((attempt) => attempt.identity),
			[`clipboard-cross-app:omo-native:${startIteration + 29}`],
		);
	}
});

test("#given stage metadata or pairing mismatches #when verifying #then reject rather than relabel archived rows", () => {
	for (const mutate of [
		(report) => {
			report.start_iteration = 1;
		},
		(report) => {
			report.start_iteration = undefined;
		},
		(report) => {
			report.results[0].iteration = 30;
		},
		(report) => {
			report.results[0].iteration = 61;
		},
		(report) => {
			report.results[1] = report.results[0];
		},
	]) {
		const { report, read } = cohort(30, 31);
		mutate(report);
		assert.throws(() => verifyAppsAgentCohort(report, 30, read, 31));
	}
	const { report, read } = cohort();
	assert.equal(verifyAppsAgentCohort(report, 30, read).verified_full_fixture_cohort, true);
	report.start_iteration = 1;
	assert.equal(verifyAppsAgentCohort(report, 30, read).verified_full_fixture_cohort, true);
	assert.throws(() => verifyAppsAgentCohort(report, 2, read, Number.MAX_SAFE_INTEGER));
});

test("#given explicit stage CLI bounds #when parsing #then require both safe start and count without pilot mixing", () => {
	assert.deepEqual(parseVerifierArgs(["raw.json", "--start-iteration", "31", "--runs", "30"]), {
		file: "raw.json",
		requiredPairs: 30,
		startIteration: 31,
	});
	for (const args of [
		["--start-iteration", "31"],
		["--runs", "30"],
		["--start-iteration", "--runs", "30"],
		["--start-iteration", "0", "--runs", "30"],
		["--start-iteration", "31", "--runs", "1.5"],
		["--start-iteration", "9007199254740992", "--runs", "30"],
		["--start-iteration", "9007199254740991", "--runs", "2"],
		["--pilot", "9007199254740992"],
		["--pilot", "1", "--start-iteration", "31", "--runs", "30"],
	])
		assert.throws(() => parseVerifierArgs(["raw.json", ...args]));
});

test("#given task success with an activation #when verifying #then retains task outcome but fails the safe cohort", () => {
	const { report, read } = cohort(1);
	report.results[0].focus_disturbance = true;
	report.results[0].disturbance_trace.activations.push({ ms: 1, bundle: "com.apple.Safari" });
	const result = verifyAppsAgentCohort(report, 1, read);
	assert.equal(result.attempts[0].pass, true);
	assert.equal(result.attempts[0].safety_pass, false);
	assert.equal(result.verified_full_safe_cohort, false);
});

test("#given absent provenance or inaccessible raw logs #when analyzing losses #then reports unsupported evidence", () => {
	const { report } = cohort();
	report.fixture_provenance = null;
	for (const row of report.results) {
		row.pass = false;
		row.oracle_inputs = undefined;
	}
	const result = verifyAppsAgentCohort(report, 30, () => {
		throw new Error("missing archive");
	});
	assert.equal(result.verified_full_fixture_cohort, false);
	assert.equal(result.failed_attempts.length, 60);
	assert.ok(result.issues.length > 0);
});
