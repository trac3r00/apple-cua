import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	buildAttemptMatrix,
	buildPlan,
	closeOwnedWindows,
	main,
	measure,
	openOwnedWindow,
	ownedCloseScript,
	ownedTextWindowLive,
	pageCompleted,
	parseArgs,
} from "./browser-run.mjs";

test("#given an owned TextEdit fixture path #when closing #then synchronously targets only that document", () => {
	const path = "/tmp/cua-bench/browser-owned.txt";
	const script = ownedCloseScript({ owner_bundle: "com.apple.TextEdit", fixture_path: path });
	assert.equal(typeof script, "string");
	assert.ok(script.includes(JSON.stringify(path)));
	assert.ok(script.includes(JSON.stringify(`/private${path}`)));
	assert.ok(script.includes("saving no"));
});

test("#given a closed owned document with retired AX surface #when checking closure #then independent document absence is required", () => {
	assert.equal(ownedTextWindowLive(0, true, false), false);
	assert.equal(ownedTextWindowLive(1, true, false), true);
	assert.equal(ownedTextWindowLive(0, false, true), true);
	assert.equal(ownedTextWindowLive(1, false, false), true);
});

const source = readFileSync(new URL("./browser-run.mjs", import.meta.url), "utf8");
test("#given importable harness #when loaded #then no collection runs", () => {
	assert.equal(typeof main, "function");
});
test("#given existing output #when starting #then overwrite is refused", async () => {
	await assert.rejects(
		main({ output: fileURLToPath(new URL("./browser-run.test.mjs", import.meta.url)) }),
		/existing benchmark artifact refused/,
	);
});
test("#given defaults and pilot options #when scheduling #then preserves seeded pairs and isolates pilot", () => {
	const defaults = buildAttemptMatrix();
	assert.equal(defaults.length, 300);
	assert.deepEqual(buildAttemptMatrix(), defaults);
	const options = parseArgs([
		"--runs",
		"1",
		"--scenarios",
		"safari-form",
		"--drivers",
		"cua",
		"--out",
		"/tmp/pilot.json",
	]);
	assert.deepEqual(buildAttemptMatrix(options), [{ iteration: 1, scenario: "safari-form", route: "cua" }]);
	for (const flags of [["--runs", "0"], ["--drivers", "bad"], ["--scenarios", "safari-form,safari-form"], ["--out"]])
		assert.throws(() => parseArgs(flags));
});
test("#given each task #when building steps #then preserves input and navigation actions", () => {
	assert.deepEqual(
		buildPlan("form", "owned").map((step) => step.op),
		["observe", "click-label", "type"],
	);
	assert.deepEqual(buildPlan("delayed", "owned"), buildPlan("form", "owned"));
	assert.deepEqual(
		buildPlan("link", "owned").map((step) => step.op),
		["observe", "click-label"],
	);
	assert.deepEqual(
		buildPlan("scroll", "owned").map((step) => step.op),
		["observe", "key", "click-label"],
	);
	assert.deepEqual(
		buildPlan("cross-app", "owned", "unique.txt").map((step) => step.op),
		["observe", "key", "key", "observe", "click-label", "key"],
	);
	assert.equal(pageCompleted("form", { nonce: "n", field: "Bench-v2 marker 8c52" }, "n"), true);
	assert.equal(pageCompleted("form", { nonce: "other", field: "Bench-v2 marker 8c52" }, "n"), false);
	assert.equal(pageCompleted("link", { nonce: "n", hash: "#destination" }, "n"), true);
});

test("#given staged browser extensions #when scheduling #then preserves paired IDs and route order", () => {
	const scenarios = ["safari-form"];
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

const bundle = "com.apple.Safari";
const personal = { pid: 1, number: 1, title: "personal", onScreen: true };
const fixture = { pid: 1, number: 2, title: "owned", onScreen: true };
function windowContext() {
	let windows = [personal];
	const events = [];
	return {
		events,
		windowObserver: "unused",
		subscribeSurface: async () => ({ ready: Promise.resolve(), cancel: () => undefined }),
		probe: { snapshot: () => ({ apps: [{ pid: 1, bundle }], windows }) },
		subscribe: async (_binary, _title, closing) => {
			events.push(closing ? "close-subscribe" : "open-subscribe");
			return { ready: Promise.resolve(), cancel: () => events.push("cancel") };
		},
		launch: () => {
			events.push("launch");
			windows = [personal, fixture];
		},
		closeWindow: async (window) => {
			events.push(`close-${window.number}`);
			windows = windows.filter((item) => item.number !== window.number);
		},
		windowExists: (window) => windows.some((item) => item.number === window.number),
	};
}
test("#given personal window #when opening and closing fixture #then exact owned identity alone is closed", async () => {
	const context = windowContext();
	const owned = [];
	await openOwnedWindow(context, "Safari", "owned", context.launch, owned);
	assert.deepEqual(context.events, ["open-subscribe", "launch", "cancel"]);
	assert.equal(owned[0].number, 2);
	const result = await closeOwnedWindows(context, owned);
	assert.deepEqual(result, { closed: [`${bundle}/2`], leftover: [], error: null });
	assert.deepEqual(context.events.slice(3), ["close-subscribe", "close-2", "cancel"]);
	assert.equal(context.probe.snapshot().windows[0].number, 1);
});
test("#given a new hidden surface independently absent from live inventories #when opening #then owns only the real fixture", async () => {
	const context = windowContext();
	const original = context.probe.snapshot;
	context.probe.snapshot = () => {
		const state = original();
		return {
			...state,
			windows: state.windows.includes(fixture)
				? [...state.windows, { pid: 1, number: 3, title: "", onScreen: false }]
				: state.windows,
		};
	};
	const owned = [];
	await openOwnedWindow(context, "Safari", "owned", context.launch, owned);
	assert.deepEqual(
		owned.map((window) => window.number),
		[2],
	);
});
test("#given creation observer failure #when launch partially succeeds #then owned identity survives for cleanup", async () => {
	const context = windowContext();
	context.subscribe = async () => ({
		ready: Promise.reject(new Error("observer failed")),
		cancel: () => undefined,
	});
	const owned = [];
	await assert.rejects(openOwnedWindow(context, "Safari", "owned", context.launch, owned), /observer failed/);
	assert.equal(owned[0].number, 2);
});
test("#given successful close notification #when exact readback still finds fixture #then cleanup fails", async () => {
	const context = windowContext();
	context.launch();
	context.closeWindow = async () => undefined;
	const result = await closeOwnedWindows(context, [{ ...fixture, owner_bundle: bundle }]);
	assert.deepEqual(result.leftover, [`${bundle}/2`]);
	assert.match(result.error, /owned window remains/);
});

test("#given an unavailable surface subscription #when cleanup begins #then fails without an unobserved close", async () => {
	const context = windowContext();
	context.launch();
	context.subscribeSurface = async () => {
		throw new Error("surface subscription refused");
	};
	const result = await closeOwnedWindows(context, [{ ...fixture, owner_bundle: bundle }]);
	assert.deepEqual(result.leftover, [`${bundle}/2`]);
	assert.ok(!context.events.includes("close-2"));
});
const cleanTrace = {
	activations: [],
	max_cursor_px: 0,
	max_appkit_cursor_px: 0,
	end_cursor_px: 0,
	cursor_samples: 2,
	front_start: "editor",
	front_end: "editor",
};
async function measurement(summary = cleanTrace, failure = false) {
	let clock = 0;
	const events = [];
	const context = {
		abort: new AbortController(),
		locked: () => false,
		now: () => clock,
		startTrace: async () => {
			events.push("trace");
			clock += 5000;
			return {
				stop: async () => {
					events.push("stop");
					clock += 7000;
					if (failure) throw new Error("missing summary");
					return summary;
				},
				cancel: () => undefined,
			};
		},
	};
	const row = { pass: false };
	const driver = {
		calls: 0,
		raw: [],
		allCallsSucceeded: true,
		step: async () => {
			events.push("step");
			clock += 1000;
			driver.calls++;
		},
	};
	await measure(row, context, driver, [{}], async () => {
		events.push("oracle");
		clock += 2000;
		return true;
	});
	return { row, context, events };
}
test("#given setup and trace overhead #when measuring #then E2E includes only driver and independent oracle", async () => {
	const { row, events } = await measurement();
	assert.equal(row.e2e_seconds, 3);
	assert.equal(row.pass, true);
	assert.deepEqual(events, ["trace", "step", "oracle", "stop"]);
});
test("#given disturbance or missing trace #when finalizing attempt #then stops collection", async () => {
	for (const summary of [
		{ ...cleanTrace, max_cursor_px: 0.1 },
		{ ...cleanTrace, activations: [{}] },
		{ ...cleanTrace, max_appkit_cursor_px: 1 },
		{},
		{ ...cleanTrace, cursor_samples: 0 },
	]) {
		assert.equal((await measurement(summary)).context.abort.signal.aborted, true);
	}
	assert.equal((await measurement(cleanTrace, true)).context.abort.signal.aborted, true);
});
test("#given window ownership #when closing #then no personal URLs are enumerated", () => {
	assert.doesNotMatch(source, /get (?:URL|path) of every document|URL starts with/);
});
test("#given prospective measurement #when collecting #then hashes and continuous trace are recorded", () => {
	assert.match(source, /source_sha256/);
	assert.match(source, /startDisturbance/);
});
