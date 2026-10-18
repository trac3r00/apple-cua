import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpClient } from "../bench-v2/client.mjs";
import { desktopProbe } from "../bench-v2/desktop.mjs";
import { BrowserDriver } from "./browser-driver.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { startPages } from "./pages.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { subscribeWindow } from "./window-event.mjs";
import { subscribeSurface } from "./window-surface-event.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dir = "/tmp/cua-bench";
const kinds = {
	"safari-form": "form",
	"safari-link": "link",
	"safari-scroll-link": "scroll",
	"safari-delayed-field": "delayed",
	"clipboard-cross-app": "cross-app",
};
const bundles = { Safari: "com.apple.Safari", TextEdit: "com.apple.TextEdit" };
const marker = "Bench-v2 marker 8c52";
const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();

export function parseArgs(flags) {
	const options = {
		runs: 30,
		startIteration: 1,
		output: resolve(".bench/v3/browser-30.json"),
		scenarios: Object.keys(kinds),
		routes: ["apple", "cua"],
	};
	for (let i = 0; i < flags.length; i++) {
		const flag = flags[i];
		if (
			!["--runs", "--out", "--scenarios", "--drivers", "--start-iteration"].includes(flag) ||
			!flags[i + 1] ||
			flags[i + 1].startsWith("--")
		)
			throw new Error(`invalid option: ${flag}`);
		const value = flags[++i];
		if (flag === "--runs") options.runs = Number(value);
		if (flag === "--start-iteration") options.startIteration = Number(value);
		if (flag === "--out") options.output = resolve(value);
		if (flag === "--scenarios") options.scenarios = value.split(",");
		if (flag === "--drivers") options.routes = value.split(",");
	}
	if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error("invalid runs");
	if (!Number.isInteger(options.startIteration) || options.startIteration < 1)
		throw new Error("invalid starting iteration");
	if (
		!options.scenarios.length ||
		options.scenarios.some((id) => !kinds[id]) ||
		new Set(options.scenarios).size !== options.scenarios.length ||
		!options.routes.length ||
		options.routes.some((route) => !["apple", "cua"].includes(route)) ||
		new Set(options.routes).size !== options.routes.length
	)
		throw new Error("unsupported or duplicate scenario or driver");
	return options;
}

export function buildAttemptMatrix({
	runs = 30,
	scenarios = Object.keys(kinds),
	routes = ["apple", "cua"],
	startIteration = 1,
} = {}) {
	const random = mulberry32(20261009);
	const attempts = [];
	for (let iteration = 1; iteration < startIteration + runs; iteration++)
		for (const scenario of scenarios)
			for (const route of shuffle(routes, random))
				if (iteration >= startIteration) attempts.push({ iteration, scenario, route });
	return attempts;
}

export function buildPlan(kind, windowTitle, textTitle) {
	const plan = [];
	if (kind === "cross-app") {
		plan.push({ op: "observe", app: "TextEdit", title: textTitle });
		for (const key of ["a", "c"])
			plan.push({ op: "key", app: "TextEdit", value: key, apple: `cmd+${key}`, cua: key, modifiers: ["cmd"] });
	}
	plan.push({ op: "observe", app: "Safari", title: windowTitle });
	if (["scroll", "link"].includes(kind)) {
		if (kind === "scroll") plan.push({ op: "key", app: "Safari", value: "End", apple: "cmd+down", cua: "end" });
		plan.push({ op: "click-label", app: "Safari", value: "Destination" });
	} else {
		plan.push({ op: "click-label", app: "Safari", value: "Code" });
		plan.push(
			kind === "cross-app"
				? { op: "key", app: "Safari", value: "v", apple: "cmd+v", cua: "v", modifiers: ["cmd"] }
				: { op: "type", app: "Safari", value: marker },
		);
	}
	return plan;
}

export function pageCompleted(kind, state, nonce) {
	return (
		typeof nonce === "string" &&
		state?.nonce === nonce &&
		(["scroll", "link"].includes(kind) ? state.hash === "#destination" : state.field === marker)
	);
}

function snapshot(probe) {
	const state = probe.snapshot();
	const apps = new Map(state.apps.map((app) => [app.pid, app.bundle]));
	return state.windows.map((window) => ({ ...window, owner_bundle: apps.get(window.pid) }));
}

export function ownedTextWindowLive(documentCount, axLive, onScreen) {
	if (!Number.isInteger(documentCount) || documentCount < 0) throw new Error("invalid owned document count");
	if (documentCount === 0 && !onScreen) return false;
	return axLive || onScreen || documentCount > 0;
}

export function ownedCloseScript(window) {
	if (window.owner_bundle === bundles.TextEdit && window.fixture_path)
		return `tell application "TextEdit" to close (every document whose path is ${JSON.stringify(window.fixture_path)} or path is ${JSON.stringify(`/private${window.fixture_path}`)}) saving no`;
	return window.owner_bundle === bundles.Safari
		? `tell application "Safari" to close (every window whose id is ${window.number})`
		: null;
}

export async function openOwnedWindow(context, app, title, launch, owned) {
	const before = snapshot(context.probe);
	const observer = await context.subscribe(context.windowObserver, title, false, bundles[app]);
	let failure;
	try {
		launch();
		await observer.ready;
	} catch (error) {
		failure = error;
	} finally {
		observer.cancel();
	}
	const created = snapshot(context.probe).filter(
		(window) =>
			window.owner_bundle === bundles[app] &&
			!before.some((old) => old.pid === window.pid && old.number === window.number),
	);
	const matches = created.filter((window) => window.title?.endsWith(title));
	for (const window of matches) owned.push(window);
	const live = created.filter((window) => matches.includes(window) || context.windowExists(window));
	if (live.length !== 1 || matches.length !== 1) throw new Error("fixture window ownership mismatch");
	if (failure) throw failure;
	return owned.at(-1);
}

export async function closeOwnedWindows(context, owned) {
	const result = { closed: [], leftover: [], error: null };
	for (const window of [...owned].reverse()) {
		const id = `${window.owner_bundle}/${window.number}`;
		try {
			const current = snapshot(context.probe).find(
				(item) => item.pid === window.pid && item.number === window.number,
			);
			if (current) {
				if (current.owner_bundle !== window.owner_bundle) throw new Error("window owner changed");
				const surface = await context.subscribeSurface(window);
				try {
					const observer = await context.subscribe(
						context.windowObserver,
						current.title,
						true,
						window.owner_bundle,
					);
					try {
						await context.closeWindow(window);
						await observer.ready;
						await surface.ready;
					} finally {
						observer.cancel();
					}
				} finally {
					surface.cancel();
				}
			}
			// AX inventory is independent of the subscription and the close command.
			if (context.windowExists(window)) throw new Error(`owned window remains: ${id}`);
			result.closed.push(id);
		} catch (error) {
			result.error ??= String(error);
			result.leftover.push(id);
		}
	}
	return result;
}

export async function measure(row, context, driver, plan, oracle) {
	let trace;
	let started;
	try {
		trace = await context.startTrace();
		started = context.now();
		for (const step of plan) {
			if (context.abort.signal.aborted || context.locked()) throw new Error("stopped or locked");
			await driver.step(step);
		}
		row.pass = await oracle();
		row.false_success = !row.pass && driver.allCallsSucceeded;
	} catch (error) {
		row.error = String(error);
	} finally {
		row.e2e_seconds = started === undefined ? 0 : (context.now() - started) / 1000;
		row.calls = driver.calls;
		row.raw = driver.raw;
		row.tokens = driver.estimated_tokens;
		row.tool_only_seconds = driver.end_to_end_seconds;
		row.cost = null;
	}
	try {
		if (!trace) throw new Error("missing disturbance trace");
		const summary = await trace.stop();
		if (
			!Array.isArray(summary?.activations) ||
			!Number.isFinite(summary.max_cursor_px) ||
			!Number.isFinite(summary.max_appkit_cursor_px) ||
			!Number.isFinite(summary.end_cursor_px) ||
			!Number.isInteger(summary.cursor_samples) ||
			summary.cursor_samples < 1 ||
			typeof summary.front_start !== "string" ||
			!summary.front_start ||
			typeof summary.front_end !== "string" ||
			!summary.front_end ||
			summary.max_cursor_px < 0
		)
			throw new Error("invalid disturbance trace");
		row.disturbance_trace = summary;
		row.focus_disturbance = summary.activations.length > 0 || summary.front_start !== summary.front_end;
		row.pointer_disturbance =
			Math.max(summary.max_cursor_px, summary.max_appkit_cursor_px, summary.end_cursor_px) > 0;
		if (row.focus_disturbance || row.pointer_disturbance) context.abort.abort();
	} catch (error) {
		row.disturbance_error = String(error);
		trace?.cancel();
		context.abort.abort();
	}
}

export async function main(options) {
	if (existsSync(options.output)) throw new Error("existing benchmark artifact refused");
	const { isScreenLocked } = await import("../../packages/core/dist/platform/macos-ffi/lock-screen.js");
	if (process.platform !== "darwin" || isScreenLocked()) throw new Error("locked or unavailable desktop");
	mkdirSync(dir, { recursive: true });
	if (lstatSync(dir).isSymbolicLink()) throw new Error("fixture root is a symlink");
	const runId = randomUUID();
	const windowObserver = `${dir}/browser-window-${runId}`;
	const traceBinary = `${dir}/browser-trace-${runId}`;
	const inventoryBinary = `${dir}/browser-inventory-${runId}`;
	const surfaceBinary = `${dir}/browser-surface-${runId}`;
	const archive = `${dir}/browser-clipboard-${runId}.plist`;
	const clipboard = `${root}/scripts/bench-v2/clipboard.swift`;
	const abort = new AbortController();
	const clients = new Map();
	const attempts = buildAttemptMatrix(options);
	const report = {
		schema: "bench-v3",
		seed: 20261009,
		runs: options.runs,
		start_iteration: options.startIteration,
		scenarios: options.scenarios,
		routes: options.routes,
		scope: "background browser driver tasks",
		results: [],
		source_sha256: Object.fromEntries(
			[
				"scripts/bench-v3/browser-run.mjs",
				"scripts/bench-v3/browser-driver.mjs",
				"scripts/bench-v3/drivers.mjs",
				"scripts/bench-v3/pages.mjs",
				"scripts/bench-v3/disturbance.mjs",
				"scripts/bench-v3/disturbance.swift",
				"scripts/bench-v3/window-event.mjs",
				"scripts/bench-v3/window-event.swift",
				"scripts/bench-v3/window-surface-event.swift",
				"scripts/bench-v3/window-surface-event.mjs",
				"scripts/bench-v3/ax-window-inventory.swift",
				"scripts/bench-v2/desktop.mjs",
				"scripts/bench-v2/desktop-state.swift",
				"scripts/bench-v2/clipboard.swift",
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
	const lock = openSync(`${dir}/.run.lock`, "wx");
	let pages;
	let clipboardSaved = false;
	const persist = () => {
		mkdirSync(resolve(options.output, ".."), { recursive: true });
		writeFileSync(options.output, JSON.stringify(report, null, 2));
	};
	const stop = () => {
		abort.abort();
		for (const client of clients.values()) client.stop();
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, stop);
	try {
		for (const [source, binary] of [
			["window-event", windowObserver],
			["disturbance", traceBinary],
			["ax-window-inventory", inventoryBinary],
			["window-surface-event", surfaceBinary],
		])
			execFileSync("swiftc", [`${root}/scripts/bench-v3/${source}.swift`, "-o", binary], { timeout: 60000 });
		probe = desktopProbe();
		pages = await startPages();
		if (options.scenarios.includes("clipboard-cross-app")) {
			execFileSync("swift", [clipboard, "save", archive], { timeout: 60000 });
			clipboardSaved = true;
		}
		for (const route of options.routes) {
			let spec = { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] };
			if (route === "apple")
				spec = {
					command: "node",
					args: [`${root}/packages/mcp/dist/server.js`],
					env: {
						APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.Safari,com.apple.TextEdit",
						APPLE_CUA_DELIVERY: "background",
					},
				};
			const client = new McpClient(spec);
			clients.set(route, client);
			await client.start();
		}
		const context = {
			probe,
			abort,
			windowObserver,
			subscribe: subscribeWindow,
			subscribeSurface: (window) => subscribeSurface(surfaceBinary, window.pid, window.number),
			locked: isScreenLocked,
			now: () => performance.now(),
			startTrace: () => startDisturbance(traceBinary),
			closeWindow: (window) => {
				const script = ownedCloseScript(window);
				return script ? osa(script) : probe.closeWindowByNumber(window.owner_bundle, window.pid, window.number);
			},
			windowExists: (window) => {
				const inventory = JSON.parse(
					execFileSync(inventoryBinary, [String(window.pid), window.owner_bundle], {
						encoding: "utf8",
						timeout: 10000,
					}),
				);
				if (window.owner_bundle === bundles.Safari) {
					const live = osa(
						`tell application "Safari"\nrepeat with w in windows\nif id of w is ${window.number} then\nif visible of w or (count tabs of w) > 0 then return "live"\nend if\nend repeat\nreturn "absent"\nend tell`,
					);
					if (live !== "absent") return true;
				}
				if (window.owner_bundle === bundles.TextEdit && window.fixture_path) {
					const count = Number(
						osa(
							`tell application "TextEdit" to count (every document whose path is ${JSON.stringify(window.fixture_path)} or path is ${JSON.stringify(`/private${window.fixture_path}`)})`,
						),
					);
					const axLive = inventory.ax_window_ids.includes(window.number);
					const onScreen = snapshot(probe).some(
						(item) => item.pid === window.pid && item.number === window.number && item.onScreen,
					);
					window.closure_readback = { document_count: count, ax_live: axLive, on_screen: onScreen };
					return ownedTextWindowLive(count, axLive, onScreen);
				}
				return (
					inventory.ax_window_ids.includes(window.number) ||
					snapshot(probe).some((item) => item.pid === window.pid && item.number === window.number && item.onScreen)
				);
			},
		};
		for (const attempt of attempts) {
			if (abort.signal.aborted) break;
			const row = {
				...attempt,
				pass: false,
				false_success: false,
				fixture_failed: false,
				e2e_seconds: 0,
				calls: 0,
				raw: [],
			};
			report.results.push(row);
			const kind = kinds[attempt.scenario];
			const id = randomUUID();
			const url = `${pages.base}/page?kind=${["link", "cross-app"].includes(kind) ? "form" : kind}&attempt=${id}`;
			const title = `Owned benchmark fixture ${id}`;
			const textTitle = `browser-${id}.txt`;
			const file = `${dir}/${textTitle}`;
			const owned = [];
			let baselineWindows;
			let ownsFile = false;
			const setupAbort = new AbortController();
			try {
				if (isScreenLocked()) throw new Error("screen locked");
				const before = probe.read();
				baselineWindows = snapshot(probe);
				const loaded = pages.waitFor(url, (state) => Boolean(state?.nonce), 10000, setupAbort.signal);
				await openOwnedWindow(
					context,
					"Safari",
					title,
					() => osa(`tell application "Safari" to make new document with properties {URL:"${url}"}`),
					owned,
				);
				if (!(await loaded)) throw new Error("fixture did not report load");
				if (kind === "cross-app") {
					writeFileSync(file, marker, { flag: "wx" });
					ownsFile = true;
					execFileSync("pbcopy", [], { input: "bench-not-copied", timeout: 10000 });
					const textWindow = await openOwnedWindow(
						context,
						"TextEdit",
						textTitle,
						() => execFileSync("open", ["-g", "-e", file], { timeout: 10000 }),
						owned,
					);
					textWindow.fixture_path = file;
				}
				if (kind === "delayed" && !(await pages.waitFor(url, (state) => state?.ready, 10000, abort.signal)))
					throw new Error("delayed field did not render");
				const after = probe.read();
				if (before.app !== after.app || before.x !== after.x || before.y !== after.y) {
					abort.abort();
					throw new Error("fixture setup disturbed desktop");
				}
				row.owned_windows = owned;
				row.baseline_nonce = pages.state(url).nonce;
				await measure(
					row,
					context,
					new BrowserDriver(attempt.route, clients.get(attempt.route)),
					buildPlan(kind, title, textTitle),
					() => pages.waitFor(url, (state) => pageCompleted(kind, state, row.baseline_nonce), 10000, abort.signal),
				);
			} catch (error) {
				row.error = String(error);
				row.fixture_failed = true;
				abort.abort();
			} finally {
				setupAbort.abort();
				row.page_state = pages.state(url) ?? null;
				row.cleanup = await closeOwnedWindows(context, owned);
				if (baselineWindows) {
					const finalWindows = snapshot(probe);
					const unexpected = finalWindows.filter(
						(window) =>
							Object.values(bundles).includes(window.owner_bundle) &&
							window.onScreen &&
							!baselineWindows.some((old) => old.pid === window.pid && old.number === window.number),
					);
					if (unexpected.length) {
						row.cleanup.error ??= "unexpected fixture window remains; unrelated windows were not closed";
						row.cleanup.leftover.push(...unexpected.map((window) => `${window.owner_bundle}/${window.number}`));
					}
				}
				if (ownsFile && !row.cleanup.leftover.length) {
					try {
						rmSync(file);
						row.cleanup.fixture_removed = !existsSync(file);
						if (!row.cleanup.fixture_removed) {
							row.cleanup.error ??= "fixture file remains";
							row.cleanup.leftover.push(file);
						}
					} catch (error) {
						row.cleanup.error ??= String(error);
						row.cleanup.leftover.push(file);
					}
				}
				if (row.cleanup.error || row.cleanup.leftover.length) abort.abort();
				persist();
			}
		}
	} catch (error) {
		report.error = String(error);
		abort.abort();
	} finally {
		stop();
		for (const attempt of attempts.slice(report.results.length))
			report.results.push({
				...attempt,
				pass: false,
				false_success: false,
				not_started: true,
				error: report.error ?? "collection stopped",
				calls: 0,
				raw: [],
				e2e_seconds: 0,
			});
		try {
			await pages?.close();
			if (clipboardSaved) {
				execFileSync("swift", [clipboard, "restore", archive], { timeout: 60000 });
				rmSync(archive);
			}
		} catch (error) {
			report.cleanup_error = String(error);
		} finally {
			probe?.close();
			for (const binary of [windowObserver, traceBinary, inventoryBinary, surfaceBinary])
				rmSync(binary, { force: true });
			closeSync(lock);
			rmSync(`${dir}/.run.lock`);
			for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, stop);
			report.finished_at = new Date().toISOString();
			persist();
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	await main(parseArgs(process.argv.slice(2)));
