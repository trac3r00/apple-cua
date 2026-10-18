import { execFileSync, spawnSync } from "node:child_process";
import { spawn } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { McpClient } from "../bench-v2/client.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { Driver } from "./drivers.mjs";
import { expectState } from "./file-oracle.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { subscribeWindow } from "./window-event.mjs";

const ROOT = "/tmp/cua-bench";
const N = Number(process.argv[3] ?? 30);
const SEED = 20261009;
const output = resolve(process.argv[2] ?? ".bench/v3/finder-30.json");
const clients = new Map();
const archive = `${ROOT}/finder-clipboard-${process.pid}.plist`;
const clipboard = fileURLToPath(new URL("../bench-v2/clipboard.swift", import.meta.url));
const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();
const fixturePath = (iteration, scenario) => `${ROOT}/finder-${iteration}-${scenario}`;
const escapeAppleScript = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

export function closeOwnedFinderWindow(id) {
	osa(`tell application "Finder" to close window id ${id}`);
	return osa(`tell application "Finder" to exists window id ${id}`) === "false";
}

export function scenarioPlan(scenario, targetPath) {
	if (scenario === "finder-create-folder")
		return [
			{ op: "observe", app: "Finder" },
			{ op: "key", app: "Finder", value: "n", apple: "shift+cmd+n", cua: "n", modifiers: ["shift", "cmd"] },
			{ op: "type", app: "Finder", value: "bench-folder" },
			{ op: "key", app: "Finder", value: "Return", cua: "return" },
		];
	if (scenario === "finder-navigate")
		return [
			{ op: "observe", app: "Finder" },
			{ op: "key", app: "Finder", value: "g", apple: "shift+cmd+g", cua: "g", modifiers: ["shift", "cmd"] },
			{ op: "type", app: "Finder", value: targetPath, cua: targetPath },
			{ op: "key", app: "Finder", value: "Return", cua: "return" },
		];
	if (scenario === "finder-rename-file")
		return [
			{ op: "observe", app: "Finder" },
			{
				op: "click-label",
				app: "Finder",
				value: "document.txt",
				keyboard: [{ op: "type", value: "document.txt" }],
			},
			{ op: "key", app: "Finder", value: "Return", cua: "return" },
			{ op: "key", app: "Finder", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
			{ op: "type", app: "Finder", value: "renamed.txt" },
			{ op: "key", app: "Finder", value: "Return", cua: "return" },
		];
	if (scenario === "finder-select-file")
		return [
			{ op: "observe", app: "Finder" },
			{
				op: "click-label",
				app: "Finder",
				value: "document.txt",
				keyboard: [{ op: "type", value: "document.txt" }],
			},
		];
	throw new Error(`unsupported Finder scenario: ${scenario}`);
}

export function ownedWindow(windows, app, id, title) {
	const matches = windows.filter(
		(window) => window.app_name === app && window.window_id === id && window.title === title,
	);
	if (matches.length !== 1) throw new Error(`owned window mismatch: ${app}/${id}/${title}`);
	return matches[0];
}

export function diskOracle(scenario, dir) {
	if (scenario === "finder-create-folder")
		return existsSync(`${dir}/bench-folder`) && lstatSync(`${dir}/bench-folder`).isDirectory();
	if (scenario === "finder-rename-file") return existsSync(`${dir}/renamed.txt`) && !existsSync(`${dir}/document.txt`);
	return false;
}

export function pathOracle(actual, expected) {
	try {
		return realpathSync(actual) === realpathSync(expected);
	} catch {
		return false;
	}
}

export function selectionOracle(selectionPaths, ownedPath) {
	return selectionPaths.length === 1 && pathOracle(selectionPaths[0], ownedPath);
}

export function combineCleanupErrors(taskFailed, taskError, cleanupErrors, message) {
	return new AggregateError(taskFailed ? [taskError, ...cleanupErrors] : cleanupErrors, message);
}

let clipboardSaved = false;
async function waitForLine(child, expected, timeoutMs = 10000) {
	const lines = createInterface({ input: child.stdout });
	return new Promise((resolveLine, reject) => {
		const timer = setTimeout(() => reject(new Error(`Finder event timeout: ${expected}`)), timeoutMs);
		lines.on("line", (line) => {
			if (line === expected) {
				clearTimeout(timer);
				resolveLine();
			}
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code) => {
			if (code !== 0) {
				clearTimeout(timer);
				reject(new Error(`Finder event helper exited ${code}`));
			}
		});
	});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (!Number.isInteger(N) || N < 1) throw new Error("invalid run count");
	mkdirSync(ROOT, { recursive: true });
	const lock = openSync(`${ROOT}/.run.lock`, "wx");
	let taskFailed = false;
	let taskError;
	const cleanupErrors = [];
	try {
		if (process.platform !== "darwin" || isScreenLocked()) throw new Error("Finder runner requires unlocked macOS");
		const observerBinary = `${ROOT}/finder-window-v3`;
		execFileSync("swiftc", [fileURLToPath(new URL("./window-event.swift", import.meta.url)), "-o", observerBinary], {
			timeout: 60000,
		});
		const traceBinary = `${ROOT}/finder-trace-v3`;
		execFileSync("swiftc", [fileURLToPath(new URL("./disturbance.swift", import.meta.url)), "-o", traceBinary], {
			timeout: 60000,
		});
		const selectionBinary = `${ROOT}/finder-selection-v3`;
		execFileSync(
			"swiftc",
			[fileURLToPath(new URL("./finder-selection.swift", import.meta.url)), "-o", selectionBinary],
			{
				timeout: 60000,
			},
		);
		execFileSync("swift", [clipboard, "save", archive], { timeout: 60000 });
		clipboardSaved = true;
		for (const route of ["apple", "cua"]) {
			let spec;
			if (route === "apple") {
				spec = {
					command: "node",
					args: [resolve("packages/mcp/dist/server.js")],
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder", APPLE_CUA_DELIVERY: "background" },
				};
			} else {
				spec = { command: `${process.env.HOME}/.local/bin/cua-driver`, args: ["mcp"] };
			}
			const client = new McpClient(spec);
			clients.set(route, client);
			await client.start();
		}
		const random = mulberry32(SEED);
		const report = { schema: "bench-v3", seed: SEED, n: N, scope: "owned Finder windows", results: [] };
		for (let iteration = 1; iteration <= N; iteration++) {
			for (const scenario of [
				"finder-create-folder",
				"finder-navigate",
				"finder-rename-file",
				"finder-select-file",
			]) {
				for (const route of shuffle(["apple", "cua"], random)) {
					const dir = fixturePath(iteration, scenario);
					if (existsSync(dir)) throw new Error(`refusing to reuse fixture path: ${dir}`);
					mkdirSync(dir, { recursive: true });
					writeFileSync(`${dir}/document.txt`, "owned Finder fixture");
					const row = { iteration, scenario, route, pass: false, false_success: false };
					const driver = new Driver(route, clients.get(route));
					let appleWindowId;
					let folderEvent;
					let observer;
					let trace;
					try {
						const initialDir = scenario === "finder-navigate" ? `${dir}/start-${basename(dir)}` : dir;
						mkdirSync(initialDir, { recursive: true });
						observer = await subscribeWindow(observerBinary, basename(initialDir), false, "com.apple.finder");
						appleWindowId = osa(
							`tell application "Finder"\nset w to make new Finder window to (POSIX file "${escapeAppleScript(initialDir)}" as alias)\nget id of w\nend tell`,
						);
						await observer.ready;
						observer.cancel();
						const listed = await driver.call("list_windows", {});
						const payload =
							listed.structuredContent ?? JSON.parse(listed.content.find((block) => block.type === "text").text);
						const windows = payload.windows.map((window) => ({
							...window,
							app_name: window.app_name ?? window.app,
						}));
						const owned = windows.find(
							(window) => window.app_name === "Finder" && window.title === basename(initialDir),
						);
						if (!owned) throw new Error("owned fixture window not enumerated");
						driver.windows.set("Finder", owned);
						if (["finder-create-folder", "finder-rename-file"].includes(scenario))
							folderEvent = await expectState(`${dir}/.watch`, () => diskOracle(scenario, dir), 300000);
						const plan = scenarioPlan(scenario, dir);
						trace = await startDisturbance(traceBinary);
						for (const step of plan) {
							if (step.op === "observe") step.title = owned.title;
							await driver.step(step);
						}
						if (scenario === "finder-create-folder" || scenario === "finder-rename-file")
							await folderEvent.wait(10000);
						const state = osa(
							`tell application "Finder" to get POSIX path of (target of Finder window id ${appleWindowId} as alias)`,
						);
						let selection = [];
						if (scenario === "finder-select-file") {
							const observedSelection = spawnSync(
								selectionBinary,
								[owned.title, dir, pathToFileURL(state).href],
								{
									encoding: "utf8",
									timeout: 10000,
								},
							);
							row.selection_status = observedSelection.status;
							row.selection_oracle = JSON.parse(observedSelection.stdout);
							selection = row.selection_oracle.verdict.selected.map((item) => item.path);
						}
						row.pass =
							scenario === "finder-navigate"
								? pathOracle(state, dir)
								: scenario === "finder-select-file"
									? row.selection_status === 0 && selectionOracle(selection, `${dir}/document.txt`)
									: diskOracle(scenario, dir);
						row.false_success = !row.pass && driver.allCallsSucceeded;
					} catch (error) {
						row.error = String(error);
					} finally {
						folderEvent?.cancel();
						observer?.cancel();
						row.calls = driver.calls;
						row.tokens = driver.estimated_tokens;
						row.cost = null;
						row.payload_text_bytes = driver.text_bytes;
						row.image_base64_bytes = driver.image_base64_bytes;
						row.e2e_seconds = driver.firstCallAt === null ? 0 : (performance.now() - driver.firstCallAt) / 1000;
						row.raw = driver.raw;
						if (trace) {
							row.disturbance_trace = await trace.stop();
							row.focus_disturbance = row.disturbance_trace.activations.length > 0;
							row.pointer_disturbance = row.disturbance_trace.max_cursor_px > 2;
						}
						row.cleanup = { ownedWindowId: appleWindowId ?? null };
						try {
							if (appleWindowId !== undefined) {
								const title = osa(`tell application "Finder" to get name of Finder window id ${appleWindowId}`);
								const closed = await subscribeWindow(observerBinary, title, true, "com.apple.finder");
								let closeError;
								try {
									if (!closeOwnedFinderWindow(appleWindowId))
										closeError = new Error("owned Finder window remains open");
									else await closed.ready;
								} catch (error) {
									closeError = error;
								}
								try {
									closed.cancel();
								} catch (error) {
									closeError = closeError
										? combineCleanupErrors(true, closeError, [error], "Finder window cleanup failed")
										: error;
								}
								if (closeError) row.cleanup.error = String(closeError);
								else row.cleanup.verified_closed = true;
							}
						} catch (error) {
							row.cleanup.error = String(error);
						}
						if (!row.cleanup.error) rmSync(dir, { recursive: true, force: true });
						report.results.push(row);
						mkdirSync(resolve(output, ".."), { recursive: true });
						writeFileSync(output, JSON.stringify(report, null, 2));
						process.stdout.write(`${route} ${scenario} ${iteration}/${N}: ${row.pass ? "PASS" : "FAIL"}\n`);
					}
					if (row.cleanup.error) throw new Error("owned Finder window cleanup failed");
				}
			}
		}
	} catch (error) {
		taskFailed = true;
		taskError = error;
	} finally {
		for (const client of clients.values()) {
			try {
				client.stop();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		try {
			if (clipboardSaved) {
				execFileSync("swift", [clipboard, "restore", archive], { timeout: 60000 });
				rmSync(archive, { force: true });
			}
		} catch (error) {
			cleanupErrors.push(error);
		}
		try {
			closeSync(lock);
		} catch (error) {
			cleanupErrors.push(error);
		}
		try {
			rmSync(`${ROOT}/.run.lock`);
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (cleanupErrors.length) throw combineCleanupErrors(taskFailed, taskError, cleanupErrors, "Finder cleanup failed");
	if (taskFailed) throw taskError;
}
