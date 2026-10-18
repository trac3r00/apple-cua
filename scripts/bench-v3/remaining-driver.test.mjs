import assert from "node:assert/strict";
import test from "node:test";
import { PAGE, PAGE_HEADING } from "../bench-v2/fixture.mjs";
import { scenario as safariHeading } from "../bench-v2/scenarios/safari-heading.mjs";
import { scenario as settingsVersion } from "../bench-v2/scenarios/settings-version.mjs";
import { scenario as twoAppsOneTask } from "../bench-v2/scenarios/two-apps-one-task.mjs";
import {
	buildAttemptMatrix,
	buildPlan,
	bundleWindows,
	closeOwnedWindows,
	failedAttempt,
	finderTargetPath,
	headingCompleted,
	openOwnedWindow,
	planForFixture,
	startedFixtureProcesses,
	unexpectedLeftovers,
	unstartedAttempt,
} from "./remaining-driver-run.mjs";

test("#given an unrelated front Finder window #when reading the owned target #then the model ID selects the owned path", () => {
	const windows = new Map([
		[42, "/owned"],
		[99, "/personal"],
	]);
	const model = (command) => {
		const id = command.match(/Finder window id (\d+)/)?.[1];
		return windows.get(id ? Number(id) : 99);
	};
	assert.equal(finderTargetPath(42, model), "/owned");
	assert.throws(() => finderTargetPath(undefined, model), /model ID required/);
	assert.throws(() => finderTargetPath("42", model), /model ID required/);
});

test("#given retired TextEdit surfaces #when model and AX inventories independently prove absence #then preflight omits only offscreen surfaces", () => {
	const bundle = "com.apple.TextEdit";
	const window = { pid: 42, number: 7, owner_bundle: bundle, onScreen: false };
	const snapshot = { windows: [window] };
	assert.deepEqual(bundleWindows(snapshot, bundle, undefined, [], 0), []);
	assert.deepEqual(bundleWindows(snapshot, bundle, undefined, undefined, 0), [window]);
	assert.deepEqual(bundleWindows(snapshot, bundle, undefined, [7], 0), [window]);
	assert.deepEqual(bundleWindows(snapshot, bundle, undefined, [], 1), [window]);
	assert.deepEqual(bundleWindows({ windows: [{ ...window, onScreen: true }] }, bundle, undefined, [], 0), [
		{ ...window, onScreen: true },
	]);
});

test("#given unavailable compositor observation #when closing Settings #then does not dispatch an unobserved close", async () => {
	const bundle = "com.apple.systempreferences";
	const window = { pid: 42, number: 7, title: "", owner_bundle: bundle };
	let closed = false;
	const probe = {
		snapshot: () => ({ apps: [{ pid: 42, bundle }], windows: closed ? [] : [window] }),
		closeWindowByNumber: async () => {
			closed = true;
		},
	};
	const cleanup = await closeOwnedWindows(probe, [window], [bundle], new AbortController().signal, {
		observeWindow: async () => ({ ready: Promise.resolve(), cancel: () => undefined }),
		observeSurface: async () => {
			throw new Error("surface unavailable");
		},
	});
	assert.equal(closed, false);
	assert.deepEqual(cleanup.leftover, [`${bundle}/7`]);
});

test("#given a cold Settings fixture #when recording ownership #then tracks only newly started owned app PIDs", () => {
	const windows = [
		{ pid: 42, owner_bundle: "com.apple.systempreferences" },
		{ pid: 43, owner_bundle: "com.apple.Safari" },
	];
	assert.deepEqual(startedFixtureProcesses({ apps: [{ pid: 43, bundle: "com.apple.Safari" }] }, windows), [
		{ pid: 42, bundle: "com.apple.systempreferences" },
	]);
});

test("#given an unexpected transient surface #when closure read-back proves absence #then retains only live leftovers", () => {
	const unexpected = ["com.apple.Safari/7/", "com.apple.Safari/8/"];
	assert.deepEqual(unexpectedLeftovers(unexpected, [{ owner_bundle: "com.apple.Safari", number: 8 }]), [
		"com.apple.Safari/8/",
	]);
	assert.deepEqual(unexpectedLeftovers(unexpected, []), []);
});

test("#given staged heading extension #when scheduling #then preserves unique IDs and the original random stream", () => {
	const scenarios = ["safari-heading"];
	const full = buildAttemptMatrix({ runs: 90, scenarios });
	assert.deepEqual(
		buildAttemptMatrix({ runs: 30, startIteration: 31, scenarios }),
		full.filter((row) => row.iteration >= 31 && row.iteration <= 60),
	);
	assert.deepEqual(
		buildAttemptMatrix({ runs: 30, startIteration: 61, scenarios }),
		full.filter((row) => row.iteration >= 61),
	);
});

test("#given the setup page report #when checking heading navigation #then requires a new document nonce", () => {
	const state = { nonce: "setup-document", heading: PAGE_HEADING };
	assert.equal(headingCompleted(state, "setup-document"), false);
	assert.equal(headingCompleted(state, null), false);
	assert.equal(headingCompleted({ ...state, nonce: "new-document" }, "setup-document"), true);
});

test("#given retired Safari surfaces and a hidden live window #when checking fixtures #then only independently empty objects are omitted", () => {
	const bundle = "com.apple.Safari";
	const windows = [
		{ owner_bundle: bundle, number: 1, onScreen: false },
		{ owner_bundle: bundle, number: 2, onScreen: false },
		{ owner_bundle: bundle, number: 3, onScreen: true },
		{ owner_bundle: bundle, number: 4, onScreen: false },
	];
	const models = [
		{ id: 1, visible: false, tabs: 0 },
		{ id: 2, visible: false, tabs: 1 },
		{ id: 3, visible: true, tabs: 1 },
	];
	assert.deepEqual(
		bundleWindows({ windows }, bundle, models).map((window) => window.number),
		[2, 3, 4],
	);
	assert.deepEqual(bundleWindows({ windows }, bundle), windows);
	assert.deepEqual(
		bundleWindows({ windows }, bundle, models, [2, 3]).map((window) => window.number),
		[2, 3],
	);
});

test("#given a cold owned fixture #when opening its window #then subscribes before launch and reads back identity", async () => {
	const calls = [];
	const bundle = "dev.apple-cua.fixture";
	const before = { apps: [{ pid: 42, bundle }], windows: [] };
	const window = { pid: 42, number: 7, title: "General", onScreen: true };
	const owned = [];
	await openOwnedWindow(
		{ snapshot: () => ({ ...before, windows: [window] }) },
		"open",
		[],
		"General",
		bundle,
		before,
		owned,
		async () => {
			calls.push("subscribed");
			return { ready: Promise.resolve(), cancel: () => calls.push("cancelled") };
		},
		() => {
			calls.push("launched");
		},
	);
	assert.deepEqual(calls, ["subscribed", "launched", "cancelled"]);
	assert.equal(owned[0].number, 7);
});

test("#given browser or Settings fixtures #when preparing actions #then no unrelated filesystem fixture is required", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const directory = mkdtempSync("/tmp/remaining-plan-");
	try {
		const absent = `${directory}/not-created`;
		assert.deepEqual(planForFixture("settings-version", {}, absent), settingsVersion.steps);
		assert.ok(planForFixture("safari-heading", { url: "http://127.0.0.1/page" }, absent).length > 0);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("#given the Safari heading scenario #when building its attempt #then preserves every original logical step", () => {
	const url = "http://127.0.0.1:1234/page";
	const expected = safariHeading.steps.map((step) => (step.op === "type" ? { ...step, value: url } : { ...step }));
	assert.deepEqual(buildPlan("safari-heading", { safariUrl: url }), expected);
});

test("#given the Settings version scenario #when building its attempt #then preserves every original logical step", () => {
	assert.deepEqual(buildPlan("settings-version", {}), settingsVersion.steps);
});

test("#given the two-app task #when building its attempt #then changes only its owned fixture path", () => {
	const taskRoot = "/tmp/cua-bench/remaining-fixture";
	const expected = twoAppsOneTask.steps.map((step) =>
		step.app === "Finder" && step.op === "type" ? { ...step, value: taskRoot } : { ...step },
	);
	assert.deepEqual(buildPlan("two-apps-one-task", { taskRoot }), expected);
	assert.equal(safariHeading.steps[2].value, `file://${PAGE}`);
});

test("#given default paired blocks #when creating the randomized matrix #then includes 30 attempts per route and task", () => {
	const attempts = buildAttemptMatrix();
	assert.equal(attempts.length, 30 * 3 * 2);
	for (let iteration = 1; iteration <= 30; iteration++) {
		for (const scenario of ["safari-heading", "settings-version", "two-apps-one-task"]) {
			const block = attempts.filter((attempt) => attempt.iteration === iteration && attempt.scenario === scenario);
			assert.deepEqual(new Set(block.map((attempt) => attempt.route)), new Set(["apple", "cua"]));
		}
	}
	assert.deepEqual(buildAttemptMatrix(), attempts);
});

test("#given a fixture failure #when recording the attempt #then it remains a failed zero-call row", () => {
	const row = failedAttempt(
		{ iteration: 4, scenario: "settings-version", route: "apple" },
		"pre-existing System Settings window refused",
		true,
	);
	assert.equal(row.pass, false);
	assert.equal(row.fixture_failed, true);
	assert.equal(row.calls, 0);
	assert.deepEqual(row.raw, []);
});

test("#given immediate cancellation #when later pairs remain #then each is recorded as not started", () => {
	const row = unstartedAttempt(
		{ iteration: 5, scenario: "two-apps-one-task", route: "cua" },
		"cancelled before fixture setup",
		true,
	);
	assert.equal(row.pass, false);
	assert.equal(row.not_started, true);
	assert.equal(row.cancelled, true);
	assert.equal(row.calls, 0);
});
