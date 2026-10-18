import assert from "node:assert/strict";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { AGENT_MODEL, AGENT_REASONING, AGENT_TIMEOUT_MS } from "./agents.mjs";
import * as runner from "./apps-agent-run.mjs";
import {
	APP_AGENT_ROUTES,
	APP_AGENT_TASKS,
	APP_AGENT_TIMEOUT_SECONDS,
	appsAgentFalseSuccess,
	appsAgentOracle,
	appsAgentPageUrl,
	buildAppsAgentSchedule,
	combineCleanupErrors,
	hasDuplicateMarker,
	parseAppsAgentOptions,
	pendingAppsAgentSlots,
} from "./apps-agent-run.mjs";

const owned = { pid: 42, bundle: "com.apple.TextEdit", number: 7 };
const documentEvidence = {
	pid: 42,
	bundle: owned.bundle,
	status: "matched",
	matched_window_ids: [7],
	unknown_document_windows: 0,
};
const inventory = { pid: 42, bundle: owned.bundle, ax_window_ids: [7] };

test("#given task disturbance or missing trace #when gating the next agent slot #then refuses further input despite task success", () => {
	const row = {
		pass: true,
		focus_disturbance: false,
		pointer_disturbance: false,
		disturbance_trace: { activations: [], max_cursor_px: 0, max_appkit_cursor_px: 0 },
	};
	assert.equal(runner.appsAgentUnsafe(row), false);
	assert.equal(runner.appsAgentUnsafe({ ...row, focus_disturbance: true }), true);
	assert.equal(runner.appsAgentUnsafe({ ...row, pointer_disturbance: true }), true);
	assert.equal(runner.appsAgentUnsafe({ ...row, disturbance_trace: undefined }), true);
	assert.equal(runner.appsAgentUnsafe({ ...row, disturbance_error: "E_TRACE" }), true);
});

test("#given historical root files #when allocating and resuming T4 #then isolate paths and preserve provenance", () => {
	const root = realpathSync(mkdtempSync(`${tmpdir()}/apps-agent-test-`));
	try {
		writeFileSync(`${root}/document.txt`, "");
		writeFileSync(`${root}/other.txt`, "other document unchanged");
		const report = {};
		const scope = runner.prepareFixtureDirectory(root, report, ["clipboard-cross-app"]);
		assert.equal(scope.lockPath, `${root}/.run.lock`);
		assert.notEqual(scope.dir, root);
		assert.equal(lstatSync(scope.dir).uid, process.getuid());
		assert.equal(runner.prepareFixtureDirectory(root, report, ["clipboard-cross-app"]).dir, scope.dir);
		assert.equal(readFileSync(`${root}/document.txt`, "utf8"), "");
		assert.equal(readFileSync(`${root}/other.txt`, "utf8"), "other document unchanged");
		assert.throws(() => runner.prepareFixtureDirectory(root, {}, ["textedit-save-sheet"]), /T5 unavailable/);
		const before = runner.snapshotFixtureFiles(root, scope.dir);
		writeFileSync(`${scope.dir}/document.txt`, "owned");
		writeFileSync(`${scope.dir}/unexpected.txt`, "unexpected");
		writeFileSync(`${root}/document.txt`, "changed historical");
		const after = runner.snapshotFixtureFiles(root, scope.dir);
		assert.notEqual(before.get("document.txt"), after.get("document.txt"));
		assert.ok([...after.keys()].some((path) => path.endsWith("/unexpected.txt")));
		assert.ok(![...after.keys()].some((path) => path.endsWith("/document.txt")));
		assert.throws(() =>
			runner.prepareFixtureDirectory(root, { fixture_directory: { ...report.fixture_directory, ino: -1 } }, []),
		);
		rmSync(scope.dir, { recursive: true });
		assert.throws(() => runner.prepareFixtureDirectory(root, report, []), /fixture directory/);
		symlinkSync(root, scope.dir);
		assert.throws(() => runner.prepareFixtureDirectory(root, report, []), /fixture directory/);
		mkdirSync(`${root}/unknown`);
		assert.throws(() => runner.prepareFixtureDirectory(root, { fixture_directory: { path: `${root}/unknown` } }, []));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("#given isolated interrupted fixtures #when recovering #then only exact owned paths with closure evidence are removed", async () => {
	const root = realpathSync(mkdtempSync(`${tmpdir()}/apps-agent-test-`));
	try {
		writeFileSync(`${root}/document.txt`, "historical");
		const scope = runner.prepareFixtureDirectory(root, {}, ["clipboard-cross-app"]);
		const file = `${scope.dir}/document.txt`;
		const control = `${scope.dir}/other.txt`;
		writeFileSync(file, "source");
		writeFileSync(control, "control");
		const row = {
			task: "clipboard-cross-app",
			owned_fixtures: [
				{ ...owned, path: file },
				{ ...owned, number: 8, path: control },
			],
		};
		const io = {
			subscribe: async () => ({ ready: Promise.resolve(), cancel: () => undefined }),
			evidence: (fixture) => ({
				document: { ...documentEvidence, status: "no_match", matched_window_ids: [] },
				inventory: { ...inventory, ax_window_ids: [] },
				windows: [{ pid: fixture.pid, number: fixture.number, onScreen: false }],
				modelCount: 0,
			}),
		};
		await assert.rejects(
			runner.cleanupOwnedFixtures(
				{ ...row, owned_fixtures: [{ ...owned, path: `${root}/document.txt` }] },
				null,
				null,
				file,
				control,
				io,
			),
			/invalid recovery ownership/,
		);
		await runner.cleanupOwnedFixtures(row, null, null, file, control, io);
		assert.equal(row.closure_evidence.length, 2);
		assert.equal(lstatSync(file, { throwIfNoEntry: false }), undefined);
		assert.equal(lstatSync(control, { throwIfNoEntry: false }), undefined);
		assert.equal(readFileSync(`${root}/document.txt`, "utf8"), "historical");
		writeFileSync(file, "unclaimed");
		await assert.rejects(
			runner.cleanupOwnedFixtures({ ...row, owned_fixtures: [] }, null, null, file, control, io),
			/no recorded exact ownership/,
		);
		assert.equal(readFileSync(file, "utf8"), "unclaimed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

const safariRetired = {
	pid: 11838,
	modelPid: 11838,
	bundle: "com.apple.Safari",
	model: [{ number: 91, visible: false, tabCount: 0 }],
	inventory: { pid: 11838, bundle: "com.apple.Safari", ax_window_ids: [] },
};
const retiredSnapshot = {
	apps: [{ pid: 11838, bundle: "com.apple.Safari" }],
	windows: [
		{ pid: 11838, number: 91, owner: "Safari", title: "document.txt", onScreen: false },
		{ pid: 11838, number: 92, owner: "Safari", title: "", onScreen: false },
	],
};

test("#given retired Safari surfaces #when checking T4 preflight #then independent absence permits setup", () => {
	assert.doesNotThrow(() => runner.assertFixtureWindowPreflight(retiredSnapshot, true, safariRetired));
});

test("#given a retired TextEdit fixture title #when exact process document and AX inventories are empty #then preflight permits setup", () => {
	const snapshot = {
		apps: [{ pid: 42, bundle: owned.bundle }],
		windows: [{ pid: 42, number: 7, owner: "TextEdit", title: "document.txt", onScreen: false }],
	};
	const evidence = {
		pid: 42,
		bundle: owned.bundle,
		modelPid: 42,
		documentCount: 0,
		inventory: { ...inventory, ax_window_ids: [] },
	};
	assert.doesNotThrow(() => runner.assertFixtureWindowPreflight(snapshot, true, null, evidence));
	for (const invalid of [null, { ...evidence, documentCount: 1 }, { ...evidence, modelPid: 43 }])
		assert.throws(() => runner.assertFixtureWindowPreflight(snapshot, true, null, invalid));
});

test("#given newly numbered retired Safari surfaces #when checking cleanup #then they are not live leftovers", () => {
	assert.deepEqual(runner.fixtureWindowLeftovers(retiredSnapshot, new Set(), safariRetired, []), []);
});

test("#given an offscreen AppKit service surface #when independent bound AX inventory is empty #then records it without claiming an owned leftover", () => {
	const window = { pid: 42, number: 7, owner: "ThemeWidgetControlViewService", onScreen: false };
	const evidence = { pid: 42, bundle: "com.apple.appkit.xpc.ThemeWidgetControlViewService", ax_window_ids: [] };
	const snapshot = { apps: [{ pid: 42, bundle: evidence.bundle }], windows: [window] };
	assert.deepEqual(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], [evidence]), []);
	assert.deepEqual(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], []), [`${window.owner}:undefined`]);
	assert.equal(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], [{ ...evidence, pid: 43 }]).length, 1);
	assert.equal(
		runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], [{ ...evidence, ax_window_ids: [7] }]).length,
		1,
	);
	assert.equal(
		runner.fixtureWindowLeftovers(
			{ ...snapshot, windows: [{ ...window, onScreen: true }] },
			new Set(),
			null,
			[],
			[evidence],
		).length,
		1,
	);
});

test("#given the independently inactive cursor service #when classifying cleanup #then preserves live or unknown surfaces", () => {
	const window = { pid: 512, number: 6614, owner: "CursorUIViewService", onScreen: false };
	const evidence = { pid: 512, bundle: "com.apple.TextInputUI.xpc.CursorUIViewService", ax_window_ids: [] };
	const snapshot = { apps: [{ pid: 512, bundle: evidence.bundle }], windows: [window] };
	assert.deepEqual(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], [evidence]), []);
	assert.equal(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], []).length, 1);
	const live = { ...snapshot, windows: [{ ...window, onScreen: true }] };
	assert.equal(runner.fixtureWindowLeftovers(live, new Set(), null, [], [evidence]).length, 1);
});

test("#given live or unknown Safari evidence #when checking guards #then refuse preflight and retain leftovers", () => {
	for (const evidence of [
		null,
		{ ...safariRetired, pid: 11839 },
		{ ...safariRetired, modelPid: 11839 },
		{ ...safariRetired, model: null },
		{ ...safariRetired, model: [{ number: 91, visible: false, tabCount: 1 }] },
		{ ...safariRetired, model: [{ number: 91, visible: true, tabCount: 0 }] },
		{ ...safariRetired, inventory: { ...safariRetired.inventory, ax_window_ids: [92] } },
		{ ...safariRetired, inventory: { ...safariRetired.inventory, pid: 11839 } },
	]) {
		assert.throws(() => runner.assertFixtureWindowPreflight(retiredSnapshot, true, evidence));
		assert.ok(runner.fixtureWindowLeftovers(retiredSnapshot, new Set(), evidence, []).length > 0);
	}
	for (const window of [
		{ ...retiredSnapshot.windows[0], pid: 11839 },
		{ ...retiredSnapshot.windows[0], onScreen: true },
		{ ...retiredSnapshot.windows[0], onScreen: undefined },
	]) {
		const snapshot = { ...retiredSnapshot, windows: [window] };
		assert.throws(() => runner.assertFixtureWindowPreflight(snapshot, true, safariRetired));
		assert.equal(runner.fixtureWindowLeftovers(snapshot, new Set(), safariRetired, []).length, 1);
	}
});

test("#given no WS surface #when Safari model or AX evidence is live or unknown #then preflight still refuses", () => {
	const snapshot = { ...retiredSnapshot, windows: [] };
	assert.doesNotThrow(() => runner.assertFixtureWindowPreflight(snapshot, true, safariRetired));
	assert.throws(() => runner.assertFixtureWindowPreflight(snapshot, true, null));
	assert.throws(() =>
		runner.assertFixtureWindowPreflight(snapshot, true, {
			...safariRetired,
			model: [{ number: 91, visible: false, tabCount: 1 }],
		}),
	);
	const duplicate = { ...retiredSnapshot, windows: [retiredSnapshot.windows[0], retiredSnapshot.windows[0]] };
	assert.throws(() => runner.assertFixtureWindowPreflight(duplicate, true, safariRetired));
	assert.equal(runner.fixtureWindowLeftovers(duplicate, new Set(), safariRetired, []).length, 2);
});

test("#given exact owned TextEdit closure #when checking WS leftovers #then only that retired identity is excluded", () => {
	const snapshot = {
		apps: [{ pid: 42, bundle: owned.bundle }],
		windows: [
			{ pid: 42, number: 7, owner: "TextEdit", title: "document.txt", onScreen: false },
			{ pid: 42, number: 8, owner: "TextEdit", title: "unknown.txt", onScreen: false },
		],
	};
	const closure = {
		...owned,
		document: { ...documentEvidence, status: "no_match", matched_window_ids: [] },
		inventory: { ...inventory, ax_window_ids: [] },
		modelCount: 0,
	};
	assert.deepEqual(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [closure]), ["TextEdit:unknown.txt"]);
	assert.equal(
		runner.fixtureWindowLeftovers(snapshot, new Set(), null, [{ ...closure, modelCount: undefined }]).length,
		2,
	);
	assert.equal(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [{ ...closure, pid: 43 }]).length, 2);
});

test("#given successive owned closures #when a prior surface remains offscreen #then fresh evidence excludes only verified identities", () => {
	const previous = { ...owned, number: 6, path: "/tmp/cua-bench/other.txt", closed: true };
	const current = { ...owned, closed: true };
	const snapshot = {
		apps: [{ pid: 42, bundle: owned.bundle }],
		windows: [6, 7, 8].map((number) => ({
			pid: 42,
			number,
			owner: "TextEdit",
			title: "other.txt",
			onScreen: false,
		})),
	};
	const refreshed = [];
	const evidence = (target) => {
		refreshed.push(target.number);
		return {
			document: { ...documentEvidence, status: "no_match", matched_window_ids: [] },
			inventory: { ...inventory, ax_window_ids: [] },
			modelCount: 0,
		};
	};
	const closures = runner.refreshCleanupClosures(
		[{ closure_evidence: [previous] }],
		{ closure_evidence: [current] },
		evidence,
	);
	assert.deepEqual(refreshed, [6, 7]);
	assert.deepEqual(runner.fixtureWindowLeftovers(snapshot, new Set(), null, closures), ["TextEdit:other.txt"]);
	assert.equal(
		runner.fixtureWindowLeftovers(
			snapshot,
			new Set(),
			null,
			closures.map((closure) => ({ ...closure, inventory: { ...inventory, ax_window_ids: [6] } })),
		).length,
		2,
	);
});

test("#given an offscreen TextKit surface #when its bound AX inventory is empty #then only that inactive service is excluded", () => {
	const bundle = "com.apple.textkit.nsattributedstringagent";
	const window = { pid: 42, number: 7, owner: "nsattributedstringagent", title: "", onScreen: false };
	const snapshot = { apps: [{ pid: 42, bundle }], windows: [window] };
	const evidence = { pid: 42, bundle, ax_window_ids: [] };
	assert.deepEqual(runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], [evidence]), []);
	for (const inventory of [null, { ...evidence, pid: 43 }, { ...evidence, ax_window_ids: [7] }])
		assert.equal(
			runner.fixtureWindowLeftovers(snapshot, new Set(), null, [], inventory ? [inventory] : []).length,
			1,
		);
	assert.equal(
		runner.fixtureWindowLeftovers(
			{ ...snapshot, windows: [{ ...window, onScreen: true }] },
			new Set(),
			null,
			[],
			[evidence],
		).length,
		1,
	);
});

test("#given exact document evidence #when claiming ownership #then require unique PID and AX identity", () => {
	assert.equal(runner.validateDocumentIdentity(documentEvidence, owned, true), 7);
	for (const evidence of [
		{ ...documentEvidence, status: "ax_windows_failed" },
		{ ...documentEvidence, pid: 43 },
		{ ...documentEvidence, matched_window_ids: [7, 8] },
		{ ...documentEvidence, unknown_document_windows: 1 },
		{ ...documentEvidence, status: "no_match", matched_window_ids: [] },
	])
		assert.throws(() => runner.validateDocumentIdentity(evidence, owned, true));
});

test("#given closure evidence #when verifying #then require document and AX absence plus offscreen surface", () => {
	const absent = { ...documentEvidence, status: "no_match", matched_window_ids: [] };
	const axAbsent = { ...inventory, ax_window_ids: [] };
	assert.equal(runner.validateOwnedClosure(owned, absent, axAbsent, [], 0), true);
	assert.throws(() => runner.validateOwnedClosure(owned, null, axAbsent, [], 0));
	assert.throws(() => runner.validateOwnedClosure(owned, absent, inventory, [], 0));
	assert.throws(() => runner.validateOwnedClosure(owned, absent, axAbsent, [], 1));
	assert.throws(() => runner.validateOwnedClosure(owned, { ...absent, unknown_document_windows: 1 }, axAbsent, [], 0));
	assert.throws(() =>
		runner.validateOwnedClosure(owned, absent, axAbsent, [{ pid: 42, number: 7, onScreen: true }], 0),
	);
	assert.throws(() =>
		runner.validateOwnedClosure(owned, absent, axAbsent, [{ pid: 43, number: 7, onScreen: false }], 0),
	);
});

test("#given old provenance or T5 #when preparing fixtures #then refuse before recovery or fixture creation", () => {
	assert.throws(() => runner.assertFixturePolicy({}, { revision: "new", source_hashes: {} }));
	const policy = { revision: "new", source_hashes: { runner: "hash" } };
	assert.doesNotThrow(() => runner.assertFixturePolicy({ fixture_provenance: policy }, policy));
	assert.throws(() =>
		runner.assertFixturePolicy({ fixture_provenance: { ...policy, source_hashes: { runner: "old" } } }, policy),
	);
	assert.throws(() => runner.assertTaskAvailable("textedit-save-sheet"), /unsaved document ownership/);
	assert.doesNotThrow(() => runner.assertTaskAvailable("clipboard-cross-app"));
});

test("#given Safari model IDs #when matching independent inventories #then reject ambiguity and PID reuse", () => {
	const safari = { pid: 42, bundle: "com.apple.Safari", number: 7 };
	const ax = { ...inventory, bundle: safari.bundle };
	const windows = [{ pid: 42, number: 7, onScreen: true }];
	assert.equal(runner.validateSurfaceOwnership(safari, [7], ax, windows), true);
	for (const ids of [[], [7, 8], [8], [7, 7]])
		assert.throws(() => runner.validateSurfaceOwnership(safari, ids, ax, windows));
	assert.throws(() => runner.validateSurfaceOwnership(safari, [7], ax, [{ ...windows[0], pid: 43 }]));
	assert.throws(() => runner.validateSurfaceOwnership(safari, [7], { ...ax, ax_window_ids: [] }, windows));
	assert.throws(() => runner.validateSurfaceOwnership(safari, [7], { ...ax, ax_window_ids: [7, 7] }, windows));
});

test("#given owned closure #when closing #then subscribe and revalidate before mutation and read back after surface signal", async () => {
	const events = [];
	const absent = { ...documentEvidence, status: "no_match", matched_window_ids: [] };
	const io = {
		async subscribe() {
			events.push("subscribed");
			return { ready: Promise.resolve().then(() => events.push("surface")), cancel: () => events.push("cancel") };
		},
		validate: () => events.push("validate"),
		close: () => events.push("close"),
		evidence() {
			events.push("read");
			return { document: absent, inventory: { ...inventory, ax_window_ids: [] }, windows: [], modelCount: 0 };
		},
	};
	assert.equal((await runner.closeOwnedFixture(owned, io)).closed, true);
	assert.ok(events.indexOf("subscribed") < events.indexOf("close"));
	assert.ok(events.indexOf("validate") < events.indexOf("close"));
	assert.ok(events.indexOf("surface") < events.indexOf("read"));
	assert.equal(events.at(-1), "cancel");
	events.length = 0;
	await assert.rejects(
		runner.closeOwnedFixture(owned, {
			...io,
			validate() {
				throw new Error("identity changed");
			},
		}),
		/identity changed/,
	);
	assert.ok(!events.includes("close"));
	assert.equal(events.at(-1), "cancel");
	events.length = 0;
	await assert.rejects(
		runner.closeOwnedFixture(owned, {
			...io,
			async subscribe() {
				throw new Error("stream unavailable");
			},
		}),
		/stream unavailable/,
	);
	assert.deepEqual(events, []);
});

test("#given task and cleanup failures #when combining them #then retain both failures", () => {
	const taskError = new Error("task failed");
	const cleanupError = new Error("cleanup failed");
	const error = combineCleanupErrors(true, taskError, [cleanupError], "run cleanup failed");
	assert.ok(error instanceof AggregateError);
	assert.equal(error.message, "run cleanup failed");
	assert.equal(error.errors[0], taskError);
	assert.equal(error.errors[1], cleanupError);
});

test("#given saved files and an unsaved control edit #when checking two windows #then the oracle rejects it", () => {
	const files = {
		source: "Bench-v2 marker 8c52",
		source_document: "Bench-v2 marker 8c52",
		control: "other document unchanged",
		control_document: "unsaved wrong edit",
	};
	assert.equal(appsAgentOracle("textedit-two-windows", null, files).pass, false);
	assert.equal(
		appsAgentOracle("textedit-two-windows", null, { ...files, control_document: "other document unchanged" }).pass,
		true,
	);
});

test("#given no options #when parsing app agent runs #then use preregistered paired defaults", () => {
	assert.deepEqual(parseAppsAgentOptions([]), {
		runs: 30,
		startIteration: 1,
		seed: 20261009,
		routes: APP_AGENT_ROUTES,
		tasks: APP_AGENT_TASKS,
	});
	assert.equal(AGENT_MODEL, "gpt-6-astra");
	assert.equal(AGENT_REASONING, "high");
	assert.equal(APP_AGENT_TIMEOUT_SECONDS, 300);
	assert.equal(AGENT_TIMEOUT_MS, 300_000);
	assert.deepEqual(APP_AGENT_ROUTES, [
		"omo-apple",
		"omo-cua",
		"omo-native",
		"codex-apple",
		"codex-cua",
		"codex-native",
	]);
});

test("#given custom selections #when parsing #then preserve order and values", () => {
	assert.deepEqual(
		parseAppsAgentOptions([
			"--runs",
			"2",
			"--seed",
			"37",
			"--routes",
			"codex-native,omo-apple",
			"--tasks",
			"textedit-save-sheet",
		]),
		{ runs: 2, startIteration: 1, seed: 37, routes: ["codex-native", "omo-apple"], tasks: ["textedit-save-sheet"] },
	);
});

test("#given invalid app-agent selections #when parsing #then reject them", () => {
	for (const args of [
		["--runs", "0"],
		["--runs"],
		["--seed", "x"],
		["--routes", "unknown"],
		["--routes", "omo-apple,omo-apple"],
		["--tasks", "unknown"],
		["--tasks", "clipboard-cross-app,clipboard-cross-app"],
	])
		assert.throws(() => parseAppsAgentOptions(args));
});

test("#given a seed #when building paired blocks #then route order is reproducible and complete", () => {
	const options = {
		runs: 30,
		seed: 20261009,
		routes: APP_AGENT_ROUTES,
		tasks: APP_AGENT_TASKS,
	};
	const first = buildAppsAgentSchedule(options);
	assert.deepEqual(buildAppsAgentSchedule(options), first);
	assert.equal(first.length, 30 * APP_AGENT_TASKS.length * APP_AGENT_ROUTES.length);
	for (const task of APP_AGENT_TASKS)
		for (let iteration = 1; iteration <= 30; iteration++) {
			const block = first.filter((slot) => slot.task === task && slot.iteration === iteration);
			assert.deepEqual(new Set(block.map((slot) => slot.route)), new Set(APP_AGENT_ROUTES));
		}
});

test("#given a report with interrupted rows #when resuming #then retain them and retry only unfinished slots", () => {
	const schedule = [
		{ iteration: 1, task: "clipboard-cross-app", route: "omo-apple" },
		{ iteration: 1, task: "clipboard-cross-app", route: "omo-cua" },
	];
	const interrupted = { ...schedule[0], interrupted: true, error: "process interrupted" };
	const completed = { ...schedule[1], interrupted: false, pass: false };
	assert.deepEqual(pendingAppsAgentSlots(schedule, [interrupted, completed]), [schedule[0]]);
	assert.equal(interrupted.error, "process interrupted");
});

test("#given multiroute multitask seeds #when scheduling extension stages #then consume the full prefix PRNG stream", () => {
	for (const seed of [20261009, 37]) {
		const options = { runs: 90, seed, routes: APP_AGENT_ROUTES, tasks: APP_AGENT_TASKS };
		const full = buildAppsAgentSchedule(options);
		assert.deepEqual(buildAppsAgentSchedule({ ...options, startIteration: 1 }), full);
		for (const startIteration of [31, 61]) {
			const stage = buildAppsAgentSchedule({ ...options, runs: 30, startIteration });
			assert.deepEqual(
				stage,
				full.filter((slot) => slot.iteration >= startIteration && slot.iteration < startIteration + 30),
			);
		}
	}
	assert.equal(parseAppsAgentOptions(["--runs", "30", "--start-iteration", "31"]).startIteration, 31);
});

test("#given invalid iteration ranges #when parsing or scheduling #then reject unsafe bounds and missing values", () => {
	for (const value of ["0", "-1", "1.5", "Infinity", "9007199254740992"]) {
		assert.throws(() => parseAppsAgentOptions(["--start-iteration", value]));
		assert.throws(() => parseAppsAgentOptions(["--runs", value]));
		for (const options of [
			{ runs: Number(value), startIteration: 1 },
			{ runs: 1, startIteration: Number(value) },
		])
			assert.throws(() => buildAppsAgentSchedule({ ...options, seed: 37, routes: [], tasks: [] }));
	}
	for (const args of [
		["--start-iteration"],
		["--start-iteration", "--runs", "30"],
		["--start-iteration", "9007199254740991", "--runs", "2"],
	])
		assert.throws(() => parseAppsAgentOptions(args));
	assert.throws(() =>
		buildAppsAgentSchedule({ runs: 2, startIteration: Number.MAX_SAFE_INTEGER, seed: 37, routes: [], tasks: [] }),
	);
});

test("#given routes in one paired block #when opening task pages #then oracle state cannot alias another route", () => {
	const urls = APP_AGENT_ROUTES.map((route) => appsAgentPageUrl("http://127.0.0.1:1234", { iteration: 1, route }));
	assert.equal(new Set(urls).size, APP_AGENT_ROUTES.length);
	for (const url of urls) assert.equal(new URL(url).searchParams.get("kind"), "form");
});

test("#given task state #when evaluating T4 and T5 #then independent source and control oracles decide", () => {
	const t4 = appsAgentOracle(
		"clipboard-cross-app",
		{ field: "Bench-v2 marker 8c52" },
		{
			source: "Bench-v2 marker 8c52",
			source_document: "Bench-v2 marker 8c52",
			control: "other document unchanged",
			control_document: "other document unchanged",
			saved: null,
		},
	);
	assert.equal(t4.pass, true);
	assert.equal(
		appsAgentOracle(
			"clipboard-cross-app",
			{ field: "Bench-v2 marker 8c52" },
			{
				source: "Bench-v2 marker 8c52",
				source_document: "Bench-v2 marker 8c52",
				control: "other document unchanged",
				control_document: "unexpected unsaved edit",
			},
		).pass,
		false,
	);
	assert.equal(
		appsAgentOracle(
			"clipboard-cross-app",
			{ field: "wrong" },
			{
				source: "Bench-v2 marker 8c52",
				source_document: "Bench-v2 marker 8c52",
				control: "other document unchanged",
				control_document: "other document unchanged",
			},
		).pass,
		false,
	);
	assert.equal(
		appsAgentOracle("textedit-save-sheet", null, {
			saved: "Bench-v2 marker 8c52",
			control: "other document unchanged",
			control_document: "other document unchanged",
		}).pass,
		true,
	);
	assert.equal(
		appsAgentOracle("textedit-save-sheet", null, {
			saved: "Bench-v2 marker 8c52",
			control: "changed",
			control_document: "other document unchanged",
		}).pass,
		false,
	);
	assert.equal(appsAgentFalseSuccess({ result: "DONE" }, false), true);
	assert.equal(appsAgentFalseSuccess({ result: "NOT DONE" }, false), false);
	assert.equal(hasDuplicateMarker("Bench-v2 marker 8c52"), false);
	assert.equal(hasDuplicateMarker("Bench-v2 marker 8c52Bench-v2 marker 8c52"), true);
});
