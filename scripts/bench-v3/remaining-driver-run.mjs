#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { McpClient } from "../bench-v2/client.mjs";
import { desktopProbe } from "../bench-v2/desktop.mjs";
import { PAGE_HEADING, TARGET, windowText } from "../bench-v2/fixture.mjs";
import { safariMatches, startOracleServer } from "../bench-v2/oracle-server.mjs";
import { scenario as safariHeading } from "../bench-v2/scenarios/safari-heading.mjs";
import { scenario as settingsVersion } from "../bench-v2/scenarios/settings-version.mjs";
import { scenario as twoAppsOneTask } from "../bench-v2/scenarios/two-apps-one-task.mjs";
import { recordBrowserTrace } from "./browser-agent-run.mjs";
import { calculatorProcessGone, subscribedEvent } from "./calculator-run.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { Driver } from "./drivers.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { subscribeWindow } from "./window-event.mjs";
import { subscribeSurface } from "./window-surface-event.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtureRoot = "/tmp/cua-bench";
const runId = randomUUID();
const windowObserver = `${fixtureRoot}/remaining-window-event-${runId}`;
const traceBinary = `${fixtureRoot}/remaining-disturbance-${runId}`;
const axInventoryBinary = `${fixtureRoot}/remaining-ax-inventory-${runId}`;
const processEventBinary = `${fixtureRoot}/remaining-process-event-${runId}`;
const surfaceEventBinary = `${fixtureRoot}/remaining-surface-event-${runId}`;
const APP_BUNDLES = {
	Safari: "com.apple.Safari",
	"System Settings": "com.apple.systempreferences",
	TextEdit: "com.apple.TextEdit",
	Finder: "com.apple.finder",
};
const SCENARIOS = {
	"safari-heading": safariHeading,
	"settings-version": settingsVersion,
	"two-apps-one-task": twoAppsOneTask,
};

export function buildPlan(scenarioId, { safariUrl, taskRoot }) {
	const scenario = SCENARIOS[scenarioId];
	if (!scenario) throw new Error(`unsupported scenario: ${scenarioId}`);
	return scenario.steps.map((step) => {
		const copy = { ...step };
		if (scenarioId === "safari-heading" && copy.op === "type") copy.value = safariUrl;
		if (scenarioId === "two-apps-one-task") {
			if (copy.app === "Finder" && copy.op === "type") copy.value = taskRoot;
			if (copy.app === "Finder" && copy.op === "observe") copy.title = "start";
		}
		return copy;
	});
}

export function planForFixture(scenario, fixture, taskRoot) {
	return buildPlan(scenario, {
		safariUrl: fixture.url,
		taskRoot: scenario === "two-apps-one-task" ? realpathSync(taskRoot) : undefined,
	});
}

export function headingCompleted(state, baselineNonce) {
	return typeof baselineNonce === "string" && safariMatches("safari-heading", null, state, baselineNonce);
}

export function unexpectedLeftovers(unexpected, windows) {
	const live = new Set(windows.map((window) => `${window.owner_bundle}/${window.number}`));
	return unexpected.filter((item) => live.has(item.split("/").slice(0, 2).join("/")));
}

export function startedFixtureProcesses(before, windows) {
	const started = windows.filter((window) => !before.apps.some((app) => app.bundle === window.owner_bundle));
	const unique = new Map(started.map((window) => [window.pid, { pid: window.pid, bundle: window.owner_bundle }]));
	return [...unique.values()];
}

export function buildAttemptMatrix({
	runs = 30,
	seed = 20261009,
	scenarios = Object.keys(SCENARIOS),
	routes = ["apple", "cua"],
	startIteration = 1,
} = {}) {
	if (
		!Number.isInteger(runs) ||
		runs < 1 ||
		!Number.isInteger(seed) ||
		!Number.isInteger(startIteration) ||
		startIteration < 1
	)
		throw new Error("invalid runs, seed or starting iteration");
	if (scenarios.some((scenario) => !SCENARIOS[scenario]) || routes.some((route) => !["apple", "cua"].includes(route)))
		throw new Error("unsupported scenario or driver");
	const random = mulberry32(seed);
	const attempts = [];
	for (let iteration = 1; iteration < startIteration + runs; iteration++)
		for (const scenario of scenarios)
			for (const route of shuffle(routes, random))
				if (iteration >= startIteration) attempts.push({ iteration, scenario, route });
	return attempts;
}

export function failedAttempt({ iteration, scenario, route }, error, fixtureFailed = false) {
	return {
		iteration,
		scenario,
		route,
		pass: false,
		false_success: false,
		fixture_failed: fixtureFailed,
		error: String(error),
		e2e_seconds: 0,
		calls: 0,
		raw: [],
	};
}

export function unstartedAttempt(attempt, reason, cancelled = false) {
	return {
		...failedAttempt(attempt, reason),
		not_started: true,
		cancelled,
	};
}

function parseOption(flags, name, fallback) {
	const index = flags.indexOf(`--${name}`);
	return index < 0 ? fallback : flags[index + 1];
}

function parseArgs(flags) {
	const runs = Number(parseOption(flags, "runs", "30"));
	const seed = Number(parseOption(flags, "seed", "20261009"));
	const startIteration = Number(parseOption(flags, "start-iteration", "1"));
	const scenarios = parseOption(flags, "scenarios", Object.keys(SCENARIOS).join(",")).split(",");
	const routes = parseOption(flags, "drivers", "apple,cua").split(",");
	const output = resolve(parseOption(flags, "out", ".bench/v3/remaining-driver-30.json"));
	const attempts = buildAttemptMatrix({ runs, seed, scenarios, routes, startIteration });
	return { runs, seed, scenarios, routes, startIteration, output, attempts, dryRun: flags.includes("--dry-run") };
}

function osa(script) {
	return execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();
}

function uniqueWindow(snapshot, bundle, existing) {
	const prior = new Set(existing.map((window) => `${window.pid}:${window.number}`));
	const matches = snapshot.windows.filter(
		(window) => window.owner_bundle === bundle && !prior.has(`${window.pid}:${window.number}`) && window.onScreen,
	);
	if (matches.length !== 1) throw new Error(`fixture window ownership mismatch: ${bundle} created ${matches.length}`);
	return matches[0];
}

export function bundleWindows(snapshot, bundle, safariModels, axIds, documentCount) {
	return snapshot.windows.filter((window) => {
		if (window.owner_bundle !== bundle) return false;
		if (
			bundle === APP_BUNDLES.TextEdit &&
			documentCount === 0 &&
			Array.isArray(axIds) &&
			axIds.length === 0 &&
			window.onScreen === false
		)
			return false;
		const model = bundle === APP_BUNDLES.Safari ? safariModels?.find((item) => item.id === window.number) : undefined;
		if (
			bundle === APP_BUNDLES.Safari &&
			safariModels &&
			axIds &&
			window.onScreen === false &&
			!model &&
			!axIds.includes(window.number)
		)
			return false;
		return !(model?.visible === false && model.tabs === 0 && window.onScreen === false);
	});
}

export const safariModelRowExpression =
	'((id of w as text) & ":" & (visible of w as text) & ":" & ((count (tabs of w)) as text))';

function safariWindowModels() {
	const text = osa(
		`tell application "Safari"\nset rows to {}\nrepeat with w in windows\nset end of rows to ${safariModelRowExpression}\nend repeat\nset AppleScript's text item delimiters to linefeed\nreturn rows as text\nend tell`,
	);
	if (!text) return [];
	return text.split(/\r?\n/).map((line) => {
		const [idText, visibleText, tabsText] = line.split(":");
		const id = Number(idText);
		const tabs = Number(tabsText);
		if (!Number.isInteger(id) || !Number.isInteger(tabs) || tabs < 0 || !["true", "false"].includes(visibleText))
			throw new Error("invalid Safari window model");
		return { id, visible: visibleText === "true", tabs };
	});
}

function safariInventory(snapshot) {
	const app = snapshot.apps.find((candidate) => candidate.bundle === APP_BUNDLES.Safari);
	if (!app) return { models: [], ids: [] };
	const inventory = JSON.parse(
		execFileSync(axInventoryBinary, [String(app.pid), APP_BUNDLES.Safari], {
			encoding: "utf8",
			timeout: 10000,
		}),
	);
	return { models: safariWindowModels(), ids: inventory.ax_window_ids };
}

function normalizeSnapshot(snapshot) {
	const bundles = new Map(snapshot.apps.map((app) => [app.pid, app.bundle]));
	return {
		...snapshot,
		windows: snapshot.windows.map((window) => ({ ...window, owner_bundle: bundles.get(window.pid) ?? "" })),
	};
}

function ensureNoExistingWindows(snapshot, app) {
	const safari = app === "Safari" ? safariInventory(snapshot) : undefined;
	let documentCount;
	let axIds = safari?.ids;
	if (app === "TextEdit") {
		const apps = snapshot.apps.filter((candidate) => candidate.bundle === APP_BUNDLES.TextEdit);
		if (apps.length > 1) throw new Error("ambiguous TextEdit process");
		if (apps.length === 1) {
			const owned = apps[0];
			const inventory = JSON.parse(
				execFileSync(axInventoryBinary, [String(owned.pid), owned.bundle], { encoding: "utf8", timeout: 10000 }),
			);
			const [modelPid, count] =
				osa(`tell application "System Events" to set modelPid to unix id of first application process whose bundle identifier is "com.apple.TextEdit"
tell application "TextEdit" to set documentCount to count documents
return (modelPid as text) & "," & (documentCount as text)`)
					.split(",")
					.map(Number);
			if (
				modelPid !== owned.pid ||
				inventory.pid !== owned.pid ||
				inventory.bundle !== owned.bundle ||
				!Array.isArray(inventory.ax_window_ids) ||
				inventory.ax_window_ids.length !== 0 ||
				count !== 0
			)
				throw new Error("live or unknown TextEdit model/AX inventory refused");
			documentCount = count;
			axIds = inventory.ax_window_ids;
		}
	}
	const existing = bundleWindows(snapshot, APP_BUNDLES[app], safari?.models, axIds, documentCount);
	if (existing.length) throw new Error(`pre-existing ${app} window refused`);
}

export function finderTargetPath(modelId, readModel = osa) {
	if (!Number.isInteger(modelId) || modelId < 1) throw new Error("owned Finder model ID required");
	return readModel(`tell application "Finder" to get POSIX path of (target of Finder window id ${modelId} as alias)`);
}

function fixturePath(iteration, scenario, route) {
	return `${fixtureRoot}/remaining-${iteration}-${scenario}-${route}`;
}

export async function openOwnedWindow(
	probe,
	command,
	args,
	title,
	bundle,
	before,
	ownedWindows,
	observeWindow = subscribeWindow,
	launch = execFileSync,
) {
	const beforeWindows = normalizeSnapshot(before).windows;
	let window;
	try {
		const observer = await observeWindow(windowObserver, title ?? "*", false, bundle);
		try {
			launch(command, args, { timeout: 10000 });
			await observer.ready;
		} finally {
			observer.cancel();
		}
	} catch (error) {
		if (!window) {
			try {
				window = uniqueWindow(normalizeSnapshot(probe.snapshot()), bundle, beforeWindows);
				ownedWindows.push(window);
			} catch (inventoryError) {
				throw new Error(`${String(error)}; partial fixture window inventory failed: ${String(inventoryError)}`, {
					cause: error,
				});
			}
		}
		throw error;
	}
	const after = normalizeSnapshot(probe.snapshot());
	const observed = uniqueWindow(after, bundle, beforeWindows);
	if (window && (window.pid !== observed.pid || window.number !== observed.number))
		throw new Error(`fixture window changed during setup: ${bundle}`);
	window = observed;
	if (!ownedWindows.some((item) => item.pid === window.pid && item.number === window.number))
		ownedWindows.push(window);
	return window;
}

async function prepareFixture({ attempt, probe, before, taskRoot, pageServer, ownedWindows, taskRootCreated }) {
	const { scenario } = attempt;
	const targetApps = {
		"safari-heading": ["Safari"],
		"settings-version": ["System Settings"],
		"two-apps-one-task": ["TextEdit", "Finder"],
	}[scenario];
	for (const app of targetApps) ensureNoExistingWindows(before, app);

	if (scenario === "safari-heading") {
		const url = pageServer.url;
		const window = await openOwnedWindow(
			probe,
			"open",
			["-g", "-a", "Safari", url],
			PAGE_HEADING,
			APP_BUNDLES.Safari,
			before,
			ownedWindows,
		);
		return { url, windows: [window], targetApps };
	}
	if (scenario === "settings-version") {
		const window = await openOwnedWindow(
			probe,
			"open",
			["-g", "-a", "System Settings"],
			null,
			APP_BUNDLES["System Settings"],
			before,
			ownedWindows,
		);
		return { windows: [window], targetApps };
	}

	if (existsSync(taskRoot)) throw new Error(`refusing to reuse fixture path: ${taskRoot}`);
	mkdirSync(taskRoot, { recursive: true });
	taskRootCreated();
	const file = `${taskRoot}/document.txt`;
	const start = `${taskRoot}/start`;
	mkdirSync(start);
	writeFileSync(file, "");
	const textWindow = await openOwnedWindow(
		probe,
		"open",
		["-g", "-e", file],
		"document.txt",
		APP_BUNDLES.TextEdit,
		before,
		ownedWindows,
	);
	const finderWindow = await openOwnedWindow(
		probe,
		"open",
		["-g", start],
		"start",
		APP_BUNDLES.Finder,
		before,
		ownedWindows,
	);
	const finderModelId = Number(
		osa(`tell application "Finder"
set matches to {}
repeat with w in Finder windows
if POSIX path of (target of w as alias) is ${JSON.stringify(`${realpathSync(start)}/`)} then
set end of matches to id of w
end if
end repeat
return matches
end tell`),
	);
	if (!Number.isInteger(finderModelId) || finderModelId < 1) throw new Error("unique owned Finder model ID required");
	return { windows: [textWindow, finderWindow], targetApps, file, start, taskRoot, finderModelId };
}

export async function closeOwnedWindows(
	probe,
	windows,
	bundleIds,
	signal,
	{ observeWindow = subscribeWindow, observeSurface = subscribeSurface } = {},
) {
	const result = { closed: [], leftover: [], error: null };
	for (const window of [...windows].reverse()) {
		const bundle = bundleIds.find((candidate) => candidate === window.owner_bundle);
		try {
			const current = normalizeSnapshot(probe.snapshot());
			const currentWindow = current.windows.find((item) => item.pid === window.pid && item.number === window.number);
			if (!currentWindow) {
				result.closed.push(`${bundle}/${window.number}`);
				continue;
			}
			const surface = await observeSurface(surfaceEventBinary, window.pid, window.number);
			try {
				if (signal.aborted) {
					await probe.closeWindowByNumber(bundle, window.pid, window.number);
				} else {
					const observer = await observeWindow(windowObserver, currentWindow.title, true, bundle);
					try {
						if (bundle === APP_BUNDLES.Safari)
							osa(`tell application "Safari" to close (every window whose id is ${window.number})`);
						else await probe.closeWindowByNumber(bundle, window.pid, window.number);
						await waitWithAbort(observer.ready, signal);
					} finally {
						observer.cancel();
					}
				}
				await surface.ready;
			} finally {
				surface.cancel();
			}
			const verificationSnapshot = normalizeSnapshot(probe.snapshot());
			const safari = bundle === APP_BUNDLES.Safari ? safariInventory(verificationSnapshot) : undefined;
			if (
				bundleWindows(verificationSnapshot, bundle, safari?.models, safari?.ids).some(
					(item) => item.pid === window.pid && item.number === window.number,
				)
			)
				throw new Error(`owned window remains: ${bundle}/${window.number}`);
			result.closed.push(`${bundle}/${window.number}`);
		} catch (error) {
			const recoverySnapshot = normalizeSnapshot(probe.snapshot());
			const safari = bundle === APP_BUNDLES.Safari ? safariInventory(recoverySnapshot) : undefined;
			if (
				bundleWindows(recoverySnapshot, bundle, safari?.models, safari?.ids).some(
					(item) => item.pid === window.pid && item.number === window.number,
				)
			) {
				result.error ??= String(error);
				result.leftover.push(`${window.owner_bundle}/${window.number}`);
			} else result.closed.push(`${bundle}/${window.number}`);
		}
	}
	return result;
}

async function runAttempt(attempt, context) {
	const { probe, clients, report, output, abort, active } = context;
	const row = {
		...attempt,
		pass: false,
		false_success: false,
		fixture_failed: false,
		focus_disturbance: false,
		pointer_disturbance: false,
		calls: 0,
		e2e_seconds: 0,
		raw: [],
	};
	const driver = new Driver(attempt.route, clients.get(attempt.route));
	let fixture;
	let beforeFixture;
	let server;
	let trace;
	let startedAt = null;
	let phase = "fixture";
	let taskRoot;
	let ownsTaskRoot = false;
	let setupFocusChanged = false;
	const ownedWindows = [];
	active.fixtureWindows = ownedWindows;
	try {
		if (abort.signal.aborted) throw new Error("stopped");
		if (context.clientErrors.has(attempt.route)) {
			phase = "client";
			throw new Error(context.clientErrors.get(attempt.route));
		}
		const before = normalizeSnapshot(probe.snapshot());
		beforeFixture = before;
		taskRoot = fixturePath(attempt.iteration, attempt.scenario, attempt.route);
		if (attempt.scenario === "safari-heading") server = await startOracleServer();
		active.server = server;
		fixture = await prepareFixture({
			attempt,
			probe,
			before,
			taskRoot,
			pageServer: server,
			ownedWindows,
			taskRootCreated: () => {
				ownsTaskRoot = true;
			},
		});
		const afterSetup = probe.read();
		setupFocusChanged = afterSetup.app !== probeStartApp(context);
		if (setupFocusChanged)
			throw new Error(`fixture setup changed frontmost app from ${probeStartApp(context)} to ${afterSetup.app}`);
		const windowsAfterSetup = normalizeSnapshot(probe.snapshot());
		for (const app of fixture.targetApps) {
			const bundle = APP_BUNDLES[app];
			const safari = app === "Safari" ? safariInventory(windowsAfterSetup) : undefined;
			const windows = bundleWindows(windowsAfterSetup, bundle, safari?.models, safari?.ids);
			if (safari) row.safari_inventory = safari;
			if (windows.length !== fixture.windows.filter((window) => window.owner_bundle === bundle).length)
				throw new Error(`unexpected ${app} window during fixture setup`);
		}
		if (abort.signal.aborted) throw new Error("stopped");
		if (attempt.scenario === "safari-heading") {
			const ready = await waitWithAbort(
				server.waitFor((state) => typeof state?.nonce === "string", 10000),
				abort.signal,
			);
			if (!ready) throw new Error("setup page did not report its document nonce");
			fixture.baselineNonce = server.state.nonce;
			row.baseline_nonce = fixture.baselineNonce;
		}
		phase = "measurement";
		const beforeAction = probe.read();
		trace = await startDisturbance(traceBinary);
		active.trace = trace;
		startedAt = performance.now();
		phase = "action";
		const plan = planForFixture(attempt.scenario, fixture, taskRoot);
		for (const step of plan) {
			if (abort.signal.aborted) throw new Error("stopped");
			await driver.step(step);
		}

		if (attempt.scenario === "safari-heading") {
			row.pass = await waitWithAbort(
				server.waitFor((state) => headingCompleted(state, fixture.baselineNonce), 10000),
				abort.signal,
			);
			row.oracle_state = server.state;
		} else if (attempt.scenario === "settings-version") {
			const version = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
			row.oracle_expected_version = version;
			row.oracle_text = windowText("System Settings");
			row.pass = row.oracle_text.includes(version);
		} else {
			const expectedPath = realpathSync(fixture.file);
			const actual = readFileSync(fixture.file, "utf8").trim();
			const finderPath = realpathSync(finderTargetPath(fixture.finderModelId));
			row.actual_file = actual;
			row.finder_path = finderPath;
			row.pass = actual === TARGET && finderPath === realpathSync(fixture.taskRoot);
			row.pass &&= expectedPath === realpathSync(fixture.file);
			row.duplicate_input = actual.split(TARGET).length > 2;
			row.unintended_changes = readdirSync(fixture.taskRoot).sort().join(",") !== "document.txt,start";
		}
		row.false_success = !row.pass && driver.allCallsSucceeded;
		row.focus_disturbance = beforeAction.app !== probe.read().app;
		row.pointer_disturbance = false;
	} catch (error) {
		row.error = String(error);
		row.fixture_failed = phase === "fixture";
		row.fixture_error = phase === "fixture" ? String(error) : undefined;
		row.focus_disturbance ||= setupFocusChanged;
		if (abort.signal.aborted) row.cancelled = true;
	} finally {
		row.e2e_seconds = startedAt === null ? 0 : (performance.now() - startedAt) / 1000;
		row.tool_only_seconds = driver.end_to_end_seconds;
		row.calls = driver.calls;
		row.raw = driver.raw;
		row.tokens = driver.estimated_tokens;
		row.cost = null;
		if (trace) {
			if (!(await recordBrowserTrace(row, trace))) abort.abort();
			if (row.focus_disturbance || row.pointer_disturbance) abort.abort();
			active.trace = undefined;
		}
		if (ownedWindows.length) {
			const finalSnapshot = normalizeSnapshot(probe.snapshot());
			for (const app of fixture?.targetApps ?? []) {
				const bundle = APP_BUNDLES[app];
				const owned = new Set(
					ownedWindows
						.filter((window) => window.owner_bundle === bundle)
						.map((window) => `${window.pid}:${window.number}`),
				);
				const safari = app === "Safari" ? safariInventory(finalSnapshot) : undefined;
				for (const window of bundleWindows(finalSnapshot, bundle, safari?.models, safari?.ids)) {
					if (!owned.has(`${window.pid}:${window.number}`)) {
						row.unexpected_windows ??= [];
						row.unexpected_windows.push(`${bundle}/${window.number}/${window.title}`);
					}
				}
			}
			const bundles = ownedWindows.map((window) => window.owner_bundle);
			row.started_processes = startedFixtureProcesses(beforeFixture, ownedWindows);
			const processObservers = [];
			let processObservationError;
			try {
				for (const owned of row.started_processes) {
					const observer = subscribedEvent(processEventBinary, [String(owned.pid), owned.bundle], new Set());
					processObservers.push({ owned, observer });
					await observer.ready;
				}
			} catch (error) {
				processObservationError = String(error);
			}
			row.cleanup = await closeOwnedWindows(probe, ownedWindows, bundles, abort.signal);
			row.cleanup.processes = [];
			for (const { owned, observer } of processObservers) {
				try {
					const endedPid = Number(await observer.event);
					const verified = endedPid === owned.pid && calculatorProcessGone(owned.pid);
					row.cleanup.processes.push({ ...owned, verified });
					if (!verified) row.cleanup.error ??= `owned process remains: ${owned.bundle}/${owned.pid}`;
				} catch (error) {
					row.cleanup.processes.push({ ...owned, verified: false, error: String(error) });
					row.cleanup.error ??= String(error);
				} finally {
					observer.child.kill("SIGTERM");
				}
			}
			if (processObservationError) row.cleanup.error ??= processObservationError;
			if (row.unexpected_windows?.length) {
				const afterClosure = normalizeSnapshot(probe.snapshot());
				const liveWindows = [];
				for (const app of fixture?.targetApps ?? []) {
					const bundle = APP_BUNDLES[app];
					const safari = app === "Safari" ? safariInventory(afterClosure) : undefined;
					liveWindows.push(...bundleWindows(afterClosure, bundle, safari?.models, safari?.ids));
				}
				const leftovers = unexpectedLeftovers(row.unexpected_windows, liveWindows);
				row.cleanup.unexpected_absence_verified = leftovers.length === 0;
				if (leftovers.length) {
					row.cleanup.error ??= "unexpected app window left outside the task-owned fixture";
					row.cleanup.leftover.push(...leftovers);
				}
			}
		} else row.cleanup = { closed: [], leftover: [], error: null };
		if (ownsTaskRoot) {
			rmSync(taskRoot, { recursive: true, force: true });
			row.cleanup.fixture_root_removed = !existsSync(taskRoot);
			if (!row.cleanup.fixture_root_removed) {
				row.cleanup.error ??= "fixture directory remains after cleanup";
				row.cleanup.leftover.push(taskRoot);
			}
		}
		if (server) {
			try {
				await server.close();
			} catch (error) {
				row.cleanup.error ??= String(error);
			}
			active.server = undefined;
		}
		report.results.push(row);
		mkdirSync(resolve(output, ".."), { recursive: true });
		writeFileSync(output, JSON.stringify(report, null, 2));
		process.stdout.write(
			`${attempt.route} ${attempt.scenario} ${attempt.iteration}/${report.runs}: ${row.pass ? "PASS" : "FAIL"}\n`,
		);
		active.row = undefined;
		active.fixtureWindows = [];
	}
	return row;
}

function probeStartApp(context) {
	return context.setupFrontmostApp;
}

function waitWithAbort(promise, signal) {
	if (signal.aborted) return Promise.resolve(false);
	return Promise.race([
		promise,
		new Promise((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true })),
	]);
}

async function main(options) {
	if (process.platform !== "darwin" || isScreenLocked()) throw new Error("locked or unavailable desktop");
	if (existsSync(options.output)) throw new Error("existing benchmark artifact refused");
	mkdirSync(fixtureRoot, { recursive: true });
	if (lstatSync(fixtureRoot).isSymbolicLink())
		throw new Error("fixture root is a symlink; refusing writes outside /tmp/cua-bench");
	const lockPath = `${fixtureRoot}/.run.lock`;
	const lock = openSync(lockPath, "wx");
	const clients = new Map();
	const clientErrors = new Map();
	const abort = new AbortController();
	const report = {
		schema: "bench-v3",
		seed: options.seed,
		runs: options.runs,
		start_iteration: options.startIteration,
		scenarios: options.scenarios,
		routes: options.routes,
		scope: "background-only remaining bench-v2 driver scenarios",
		results: [],
		source_sha256: Object.fromEntries(
			[
				"scripts/bench-v3/remaining-driver-run.mjs",
				"scripts/bench-v3/drivers.mjs",
				"scripts/bench-v3/disturbance.swift",
				"scripts/bench-v3/ax-window-inventory.swift",
				"scripts/bench-v3/window-event.swift",
				"scripts/bench-v3/process-termination-event.swift",
				"scripts/bench-v3/calculator-run.mjs",
				"scripts/bench-v3/window-surface-event.swift",
				"scripts/bench-v3/window-surface-event.mjs",
				"packages/core/dist/platform/macos.js",
			].map((path) => [
				path,
				createHash("sha256")
					.update(readFileSync(`${root}/${path}`))
					.digest("hex"),
			]),
		),
	};
	let probe;
	const active = { trace: undefined, server: undefined, fixtureWindows: [], row: undefined };
	const stop = () => {
		if (abort.signal.aborted) return;
		abort.abort();
		active.trace?.cancel();
		for (const client of clients.values()) client.stop();
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, stop);
	try {
		probe = desktopProbe();
		execFileSync("swiftc", [`${root}/scripts/bench-v3/window-event.swift`, "-o", windowObserver], { timeout: 60000 });
		execFileSync("swiftc", [`${root}/scripts/bench-v3/disturbance.swift`, "-o", traceBinary], { timeout: 60000 });
		execFileSync("swiftc", [`${root}/scripts/bench-v3/ax-window-inventory.swift`, "-o", axInventoryBinary], {
			timeout: 60000,
		});
		execFileSync("swiftc", [`${root}/scripts/bench-v3/process-termination-event.swift`, "-o", processEventBinary], {
			timeout: 60000,
		});
		execFileSync("swiftc", [`${root}/scripts/bench-v3/window-surface-event.swift`, "-o", surfaceEventBinary], {
			timeout: 60000,
		});
		const setupFrontmostApp = probe.read().app;
		const context = {
			probe,
			clients,
			clientErrors,
			report,
			output: options.output,
			abort,
			active,
			setupFrontmostApp,
		};
		for (const route of options.routes) {
			let spec;
			if (route === "apple") {
				spec = {
					command: "node",
					args: [`${root}/packages/mcp/dist/server.js`],
					env: {
						APPLE_CUA_ALLOWED_BUNDLE_IDS:
							"com.apple.Safari,com.apple.systempreferences,com.apple.TextEdit,com.apple.finder",
						APPLE_CUA_DELIVERY: "background",
					},
				};
			} else {
				spec = { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] };
			}
			const client = new McpClient(spec);
			clients.set(route, client);
			try {
				await client.start();
			} catch (error) {
				clientErrors.set(route, String(error));
			}
		}
		for (let index = 0; index < options.attempts.length; index++) {
			const attempt = options.attempts[index];
			if (abort.signal.aborted || isScreenLocked()) {
				if (!abort.signal.aborted) stop();
				const reason = abort.signal.aborted
					? "cancelled before fixture setup"
					: "screen locked before fixture setup";
				for (const remaining of options.attempts.slice(index)) {
					report.results.push(unstartedAttempt(remaining, reason, abort.signal.aborted));
				}
				mkdirSync(resolve(options.output, ".."), { recursive: true });
				writeFileSync(options.output, JSON.stringify(report, null, 2));
				break;
			}
			const contextStart = context.setupFrontmostApp;
			let row;
			try {
				row = await runAttempt(attempt, context);
			} catch (error) {
				row = failedAttempt(attempt, error);
				report.results.push(row);
				mkdirSync(resolve(options.output, ".."), { recursive: true });
				writeFileSync(options.output, JSON.stringify(report, null, 2));
			}
			if (row.cleanup?.error || row.cleanup?.leftover?.length) {
				stop();
				for (const remaining of options.attempts.slice(index + 1)) {
					report.results.push(unstartedAttempt(remaining, "not started after cleanup failure"));
				}
				mkdirSync(resolve(options.output, ".."), { recursive: true });
				writeFileSync(options.output, JSON.stringify(report, null, 2));
				throw new Error(`attempt cleanup failed: ${attempt.scenario} ${attempt.route} ${attempt.iteration}`);
			}
			if (abort.signal.aborted) break;
			if (probe.read().app !== contextStart) throw new Error("frontmost app changed during benchmark");
		}
		report.finished_at = new Date().toISOString();
		mkdirSync(resolve(options.output, ".."), { recursive: true });
		writeFileSync(options.output, JSON.stringify(report, null, 2));
	} finally {
		stop();
		for (const client of clients.values()) client.stop();
		probe?.close();
		rmSync(windowObserver, { force: true });
		rmSync(traceBinary, { force: true });
		rmSync(axInventoryBinary, { force: true });
		rmSync(processEventBinary, { force: true });
		rmSync(surfaceEventBinary, { force: true });
		closeSync(lock);
		rmSync(lockPath, { force: true });
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, stop);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const options = parseArgs(process.argv.slice(2));
	if (options.dryRun) {
		process.stdout.write(
			`Validated ${options.attempts.length} attempts across ${options.scenarios.length} scenarios and ${options.routes.length} routes; no desktop input\n`,
		);
	} else await main(options);
}
