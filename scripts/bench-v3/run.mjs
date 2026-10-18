#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { McpClient } from "../bench-v2/client.mjs";
import { desktopProbe } from "../bench-v2/desktop.mjs";
import { recordBrowserTrace } from "./browser-agent-run.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { Driver } from "./drivers.mjs";
import { expectFile } from "./file-oracle.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { subscribeWindow } from "./window-event.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
export function resultDirectory(output) {
	return dirname(resolve(output));
}

export function textDocumentPaths(file) {
	return [file, file.replace("/private/tmp/", "/tmp/")];
}

export function textControlUnchanged(saved, live, secondOpen) {
	return saved === "other document unchanged" && (!secondOpen || live === "other document unchanged");
}

export function* textAttemptSchedule(seed, runs, selected, routes, startIteration = 1) {
	if (!Number.isInteger(startIteration) || startIteration < 1) throw new Error("invalid start iteration");
	const random = mulberry32(seed);
	for (let iteration = 1; iteration < startIteration + runs; iteration++)
		for (const scenario of selected)
			for (const route of shuffle(routes, random))
				if (iteration >= startIteration) yield { iteration, scenario, route };
}

const flags = process.argv.slice(2);
const option = (name, fallback) => {
	const index = flags.indexOf(`--${name}`);
	return index < 0 ? fallback : flags[index + 1];
};
const runs = Number(option("runs", "30"));
const seed = Number(option("seed", "20261009"));
const startIteration = Number(option("start-iteration", "1"));
if (!Number.isInteger(startIteration) || startIteration < 1) throw new Error("invalid start iteration");
const selected = option("scenarios", "textedit-fill-save,textedit-multiline,textedit-two-windows").split(",");
const routes = option("drivers", "apple,cua").split(",");
const target = "Bench-v2 marker 8c52";
const tasks = {
	"textedit-fill-save": { expected: target, second: false },
	"textedit-multiline": { expected: "first line\nsecond line", second: false },
	"textedit-two-windows": { expected: target, second: true },
	"stale-token-recovery": { expected: target, second: false, fault: "move" },
	"textedit-window-reopened": { expected: target, second: false, fault: "reopen" },
	"server-killed": { expected: target, second: false, fault: "death" },
};
for (const name of ["textedit-select-replace", "textedit-undo", "clipboard-copy"]) {
	const spec = (await import(`../bench-v2/scenarios/${name}.mjs`)).scenario;
	tasks[name] = {
		expected: spec.oracle.expected,
		second: false,
		initial: spec.initial,
		plan: spec.steps,
		oracleKind: spec.oracle.kind,
	};
}
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(seed)) throw new Error("invalid runs or seed");
if (selected.some((id) => !tasks[id]) || routes.some((route) => !["apple", "cua"].includes(route)))
	throw new Error("unsupported selection; this runner currently implements three text tasks only");
if (flags.includes("--dry-run")) {
	process.stdout.write(
		`Validated ${selected.length} implemented text tasks, ${routes.length} routes; no desktop input\n`,
	);
} else if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

async function main() {
	if (process.platform !== "darwin" || isScreenLocked()) throw new Error("locked or unavailable desktop");
	mkdirSync("/tmp/cua-bench", { recursive: true });
	const dir = realpathSync("/tmp/cua-bench");
	for (const path of [dir, `${dir}/document.txt`, `${dir}/other.txt`])
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("symlink fixture refused");
	const lockPath = `${dir}/.run.lock`;
	const lock = openSync(lockPath, "wx");
	const file = `${dir}/document.txt`;
	const second = `${dir}/other.txt`;
	const archive = `${dir}/clipboard-v3-${process.pid}.plist`;
	const clipboard = `${root}/scripts/bench-v2/clipboard.swift`;
	const output = option("out", `${root}/.bench/v3/text-30.json`);
	const report = flags.includes("--resume")
		? JSON.parse(readFileSync(output, "utf8"))
		: { schema: "bench-v3", seed, runs, scope: "three text tasks only", results: [] };
	if (report.seed !== seed || report.runs !== runs) throw new Error("resume seed or run count mismatch");
	const completed = new Set(report.results.map((row) => `${row.iteration}:${row.scenario}:${row.route}`));
	report.source_sha256 ??= Object.fromEntries(
		[
			"scripts/bench-v3/run.mjs",
			"scripts/bench-v3/drivers.mjs",
			"scripts/bench-v3/disturbance.swift",
			"packages/core/dist/platform/macos.js",
		].map((path) => [
			path,
			createHash("sha256")
				.update(readFileSync(`${root}/${path}`))
				.digest("hex"),
		]),
	);
	const clients = new Map();
	let probe;
	let saved = false;
	let stop = false;
	let activeOracle;
	const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 });
	const persist = () => {
		mkdirSync(resultDirectory(output), { recursive: true });
		writeFileSync(output, JSON.stringify(report, null, 2));
	};
	const halt = () => {
		stop = true;
		activeOracle?.cancel();
		for (const client of clients.values()) client.stop();
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, halt);
	try {
		probe = desktopProbe();
		const windowObserver = `${dir}/window-event-v3`;
		execFileSync("swiftc", [`${root}/scripts/bench-v3/window-event.swift`, "-o", windowObserver], { timeout: 60000 });
		const traceBinary = `${dir}/disturbance-v3`;
		execFileSync("swiftc", [`${root}/scripts/bench-v3/disturbance.swift`, "-o", traceBinary], { timeout: 60000 });
		const baseline = probe.snapshot();
		if (baseline.windows.some((window) => window.onScreen && ["document.txt", "other.txt"].includes(window.title)))
			throw new Error("fixture title already open; refusing reuse");
		execFileSync("swift", [clipboard, "save", archive], { timeout: 60000 });
		saved = true;
		report.commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		for (const route of routes) {
			let spec = { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] };
			if (route === "apple") {
				spec = {
					command: "node",
					args: [`${root}/packages/mcp/dist/server.js`],
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit", APPLE_CUA_DELIVERY: "background" },
				};
			}
			const client = new McpClient(spec);
			clients.set(route, client);
			await client.start();
		}
		for (const { iteration, scenario, route } of textAttemptSchedule(seed, runs, selected, routes, startIteration)) {
			if (completed.has(`${iteration}:${scenario}:${route}`)) continue;
			if (stop || isScreenLocked()) throw new Error("stopped or screen locked");
			const task = tasks[scenario];
			const row = { iteration, scenario, route, pass: false, false_success: false };
			const driver = new Driver(route, clients.get(route));
			let before;
			let trace;
			try {
				writeFileSync(file, task.initial ?? "");
				writeFileSync(second, "other document unchanged");
				if (task.oracleKind === "clipboard")
					execFileSync("pbcopy", [], { input: "bench-not-copied", timeout: 10000 });
				const firstWindow = await subscribeWindow(windowObserver, "document.txt");
				try {
					execFileSync("open", ["-g", "-e", file], { timeout: 10000 });
					await firstWindow.ready;
				} finally {
					firstWindow.cancel();
				}
				if (task.second) {
					const otherWindow = await subscribeWindow(windowObserver, "other.txt");
					try {
						execFileSync("open", ["-g", "-e", second], { timeout: 10000 });
						await otherWindow.ready;
					} finally {
						otherWindow.cancel();
					}
				}
				before = probe.read();
				trace = await startDisturbance(traceBinary);
				activeOracle = await expectFile(file, task.expected);
				if (task.plan) {
					for (const step of task.plan) {
						if (step.op === "assert-text") {
							const body = osa('tell application "TextEdit" to get text of document "document.txt"').trimEnd();
							if (body !== step.value) throw new Error(`checkpoint mismatch: ${body}`);
						} else await driver.step(step);
					}
				} else {
					await driver.step({ op: "observe", app: "TextEdit", title: "document.txt" });
					await driver.step({
						op: "key",
						app: "TextEdit",
						title: "document.txt",
						value: "a",
						apple: "cmd+a",
						cua: "a",
						modifiers: ["cmd"],
					});
					await driver.step({ op: "type", app: "TextEdit", title: "document.txt", value: task.expected });
					if (task.fault === "move") {
						osa(
							'tell application "System Events" to tell process "TextEdit"\nset p to position of window "document.txt"\nset position of window "document.txt" to {(item 1 of p) + 18, (item 2 of p) + 18}\nend tell',
						);
						row.injected_fault = "observed window moved before next input, no preemptive re-observation";
					}
					if (task.fault === "reopen") {
						row.fault_phase = "closing";
						row.fault_document_paths = osa(
							'tell application "TextEdit" to get path of (every document whose name is "document.txt")',
						);
						const closed = await subscribeWindow(windowObserver, "document.txt", true);
						try {
							osa(
								`tell application "TextEdit" to close (every document whose ${textDocumentPaths(file)
									.map((path) => `path is "${path}"`)
									.join(" or ")}) saving no`,
							);
							await closed.ready;
						} finally {
							closed.cancel();
						}
						row.fault_phase = "reopening";
						const reopened = await subscribeWindow(windowObserver, "document.txt");
						try {
							execFileSync("open", ["-g", "-e", file], { timeout: 10000 });
							await reopened.ready;
						} finally {
							reopened.cancel();
						}
						row.fault_phase = "recovering";
						driver.tokens.clear();
						driver.windows.clear();
						await driver.step({ op: "observe", app: "TextEdit", title: "document.txt" });
						await driver.step({ op: "type", app: "TextEdit", title: "document.txt", value: task.expected });
						row.injected_fault = "unsaved window closed and reopened before recovery";
					}
					if (task.fault === "death") {
						const old = driver.client;
						const exited = once(old.child, "exit");
						old.child.kill("SIGKILL");
						await exited;
						try {
							await old.request("tools/list", {});
						} catch (error) {
							row.death_error = String(error);
						}
						const replacement = new McpClient({ command: old.command, args: old.args, env: old.env });
						clients.set(route, replacement);
						await replacement.start();
						driver.client = replacement;
						driver.tokens.clear();
						driver.windows.clear();
						await driver.step({ op: "observe", app: "TextEdit", title: "document.txt" });
						row.injected_fault = "MCP process killed; explicit restart and re-observation";
					}
					await driver.step({
						op: "key",
						app: "TextEdit",
						title: "document.txt",
						value: "s",
						apple: "cmd+s",
						cua: "s",
						modifiers: ["cmd"],
					});
				}
				row.pass = (await activeOracle.result).pass;
				if (task.oracleKind === "clipboard") {
					row.pass = execFileSync("pbpaste", [], { encoding: "utf8", timeout: 10000 }) === task.expected;
				}
				if (scenario === "textedit-undo") {
					row.pass &&=
						osa('tell application "TextEdit" to get text of document "document.txt"').trimEnd() === task.expected;
				}
				row.actual_file = readFileSync(file, "utf8");
				row.control_file = readFileSync(second, "utf8");
				row.control_document = null;
				if (task.second) {
					row.control_document = osa(
						`tell application "TextEdit" to get text of (first document whose path is "${second}" or path is "${second.replace("/private/tmp/", "/tmp/")}")`,
					).replace(/\r?\n$/, "");
				}
				row.unintended_changes = !textControlUnchanged(row.control_file, row.control_document, task.second);
				row.pass &&= !row.unintended_changes;
				row.false_success = !row.pass && driver.allCallsSucceeded;
				row.duplicate_input = row.actual_file.split(task.expected).length > 2;
				if (task.fault) row.recovery_success = row.pass && !row.duplicate_input;
			} catch (error) {
				row.error = String(error);
			} finally {
				activeOracle?.cancel();
				activeOracle = undefined;
				row.e2e_seconds = driver.firstCallAt === null ? 0 : (performance.now() - driver.firstCallAt) / 1000;
				row.tool_only_seconds = driver.end_to_end_seconds;
				row.calls = driver.calls;
				row.tokens = driver.estimated_tokens;
				row.cost = null;
				row.raw = driver.raw;
				if (before) {
					const after = probe.read();
					row.focus_disturbance = before.app !== after.app;
					row.pointer_disturbance = Math.hypot(before.x - after.x, before.y - after.y) > 2;
				}
				if (trace) {
					if (!(await recordBrowserTrace(row, trace))) stop = true;
					if (row.focus_disturbance || row.pointer_disturbance) stop = true;
				}
				// Close by the full file path, never by front-window identity.
				try {
					const closed = await subscribeWindow(windowObserver, "document.txt", true);
					try {
						osa(
							`tell application "TextEdit"\n${[file, second]
								.map(
									(target) =>
										`close (every document whose ${textDocumentPaths(target)
											.map((path) => `path is "${path}"`)
											.join(" or ")}) saving no`,
								)
								.join("\n")}\nend tell`,
						);
						await closed.ready;
					} finally {
						closed.cancel();
					}
					row.cleanup = {
						attempted: true,
						leftover: [],
						evidence: "AX destroyed event and absence readback",
					};
					for (const target of [file, second]) {
						const count = Number(
							osa(
								`tell application "TextEdit" to count (every document whose ${textDocumentPaths(target)
									.map((path) => `path is "${path}"`)
									.join(" or ")})`,
							),
						);
						if (!Number.isInteger(count) || count !== 0) {
							row.cleanup.error = `owned document absence unverified: ${target}: ${count}`;
							row.cleanup.leftover.push(target);
							stop = true;
						}
					}
				} catch (error) {
					row.cleanup = { error: String(error) };
					stop = true;
				}
				report.results.push(row);
				persist();
				process.stdout.write(
					`${route} ${scenario} ${iteration}/${startIteration + runs - 1}: ${row.pass ? "PASS" : "FAIL"}\n`,
				);
				if (row.cleanup.error || row.cleanup.leftover.length) stop = true;
			}
			if (stop) throw new Error("cleanup not verified or user stopped");
		}
		report.finished_at = new Date().toISOString();
		persist();
	} finally {
		halt();
		probe?.close();
		if (saved) {
			execFileSync("swift", [clipboard, "restore", archive], { timeout: 60000 });
			rmSync(archive);
		}
		closeSync(lock);
		rmSync(lockPath);
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, halt);
	}
}
