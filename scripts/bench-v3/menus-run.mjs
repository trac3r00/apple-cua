#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { McpClient } from "../bench-v2/client.mjs";
import { desktopProbe } from "../bench-v2/desktop.mjs";
import { FILE, RICH, ROOT, SECOND, TARGET, rtfTextIsBold } from "../bench-v2/fixture.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { Driver } from "./drivers.mjs";
import { expectFile } from "./file-oracle.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { subscribeWindow } from "./window-event.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
export function acquireMenuLock(directory) {
	const path = resolve(directory, ".run.lock");
	return { path, fd: openSync(path, "wx") };
}

const MENU_TASKS = Object.freeze({
	"textedit-save-sheet": { fixture: "text", initial: "", oracle: "save-sheet", expected: TARGET },
	"textedit-alert-dismiss": { fixture: "text", initial: "do not save", oracle: "alert-dismiss" },
	"textedit-rich-bold": { fixture: "rich", initial: "", oracle: "rich-bold" },
});
const option = (args, name, fallback) => {
	const index = args.indexOf(`--${name}`);
	if (index < 0) return fallback;
	if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`missing --${name} value`);
	return args[index + 1];
};
export function parseMenuOptions(args) {
	const runs = Number(option(args, "runs", "30"));
	const seed = Number(option(args, "seed", "20261009"));
	const scenarios = option(args, "scenarios", Object.keys(MENU_TASKS).join(",")).split(",");
	const routes = option(args, "drivers", "apple,cua").split(",");
	if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(seed)) throw new Error("invalid runs or seed");
	if (
		!scenarios.length ||
		new Set(scenarios).size !== scenarios.length ||
		scenarios.some((id) => !Object.hasOwn(MENU_TASKS, id))
	)
		throw new Error("unsupported scenario selection");
	if (
		!routes.length ||
		new Set(routes).size !== routes.length ||
		routes.some((route) => !["apple", "cua"].includes(route))
	)
		throw new Error("unsupported driver selection");
	return { runs, seed, scenarios, routes };
}
export function menuPlan(id) {
	const app = "TextEdit";
	const key = (value, apple, cua = value, modifiers = ["cmd"]) => ({ op: "key", app, value, apple, cua, modifiers });
	const observe = (title) => ({ op: "observe", app, ...(title ? { title } : {}) });
	const type = (value, title) => ({ op: "type", app, value, ...(title ? { title } : {}) });
	switch (id) {
		case "textedit-save-sheet":
			return [
				observe(),
				key("n", "cmd+n"),
				observe("Untitled"),
				key("t", "shift+cmd+t", "t", ["shift", "cmd"]),
				type(TARGET, "Untitled"),
				key("s", "cmd+s"),
				key("g", "shift+cmd+g", "g", ["shift", "cmd"]),
				type(ROOT),
				key("Return", "Return", "return"),
				key("a", "cmd+a"),
				type("saved-from-sheet"),
				key("Return", "Return", "return"),
			];
		case "textedit-alert-dismiss":
			return [
				observe("document.txt"),
				key("a", "cmd+a"),
				type(TARGET),
				{ op: "assert-text", app, value: TARGET },
				key("w", "cmd+w"),
				key("Escape", "Escape", "escape", []),
			];
		case "textedit-rich-bold":
			return [
				observe("rich.rtf"),
				key("a", "cmd+a"),
				type(TARGET),
				key("a", "cmd+a"),
				{
					op: "menu",
					app,
					path: ["Format", "Font", "Bold"],
					keyboard: [{ value: "b", apple: "cmd+b", cua: "b", modifiers: ["cmd"] }],
				},
				key("s", "cmd+s"),
			];
		default:
			throw new Error(`unsupported scenario: ${id}`);
	}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const options = parseMenuOptions(process.argv.slice(2));
	if (process.argv.includes("--dry-run")) {
		process.stdout.write(
			`${JSON.stringify(
				{ ...options, plans: Object.fromEntries(options.scenarios.map((id) => [id, menuPlan(id)])) },
				null,
				2,
			)}\n`,
		);
	} else await main(options, option(process.argv.slice(2), "out", `${root}/.bench/v3/menus-30.json`));
}

async function main({ runs, seed, scenarios, routes }, output) {
	if (process.platform !== "darwin" || isScreenLocked()) throw new Error("locked or unavailable desktop");
	mkdirSync(ROOT, { recursive: true });
	const dir = realpathSync(ROOT);
	for (const path of [dir, FILE, SECOND, RICH, `${dir}/saved-from-sheet.txt`])
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("symlink fixture refused");
	const { path: lockPath, fd: lock } = acquireMenuLock(dir);
	const archive = `${dir}/menus-clipboard-${process.pid}.plist`;
	const clipboard = `${root}/scripts/bench-v2/clipboard.swift`;
	const report = { schema: "bench-v3", seed, runs, scope: "three TextEdit menu/dialog tasks", results: [] };
	const clients = new Map();
	let probe;
	let saved = false;
	let stop = false;
	let activeOracle;
	let traceBinary;
	let observerBinary;
	const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 });
	const persist = () => {
		mkdirSync(resolve(output, ".."), { recursive: true });
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
		observerBinary = `${dir}/window-event-menus`;
		traceBinary = `${dir}/disturbance-menus`;
		execFileSync("swiftc", [`${root}/scripts/bench-v3/window-event.swift`, "-o", observerBinary], { timeout: 60000 });
		execFileSync("swiftc", [`${root}/scripts/bench-v3/disturbance.swift`, "-o", traceBinary], { timeout: 60000 });
		const baseline = probe.snapshot();
		const initialDocuments = osa('tell application "TextEdit" to get name of every document');
		if (
			["Untitled", "saved-from-sheet.txt", "document.txt", "rich.rtf"].some((title) =>
				initialDocuments.trim().split(", ").includes(title),
			)
		)
			throw new Error("pre-existing fixture document refused");
		if (
			baseline.windows.some(
				(window) =>
					window.onScreen &&
					["document.txt", "other.txt", "rich.rtf", "Untitled", "saved-from-sheet.txt"].includes(window.title),
			)
		)
			throw new Error("fixture title already open; refusing reuse");
		execFileSync("swift", [clipboard, "save", archive], { timeout: 60000 });
		saved = true;
		for (const route of routes) {
			let spec;
			if (route === "apple") {
				spec = {
					command: "node",
					args: [`${root}/packages/mcp/dist/server.js`],
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit", APPLE_CUA_DELIVERY: "background" },
				};
			} else {
				spec = { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] };
			}
			const client = new McpClient(spec);
			clients.set(route, client);
			await client.start();
		}
		const random = mulberry32(seed);
		for (let iteration = 1; iteration <= runs; iteration++)
			for (const scenario of scenarios)
				for (const route of shuffle(routes, random)) {
					if (stop || isScreenLocked()) throw new Error("stopped or screen locked");
					const task = MENU_TASKS[scenario];
					const row = { iteration, scenario, route, pass: false, false_success: false };
					const driver = new Driver(route, clients.get(route));
					let before;
					let trace;
					const watchedTitle = scenario === "textedit-rich-bold" ? "rich.rtf" : "document.txt";
					try {
						rmSync(`${dir}/saved-from-sheet.txt`, { force: true });
						writeFileSync(FILE, task.fixture === "text" ? task.initial : "text fixture unused");
						writeFileSync(SECOND, "other document unchanged");
						writeFileSync(RICH, "{\\rtf1\\ansi\\deff0 plain text}");
						{
							const opened = await subscribeWindow(observerBinary, watchedTitle);
							try {
								execFileSync("open", ["-g", "-e", scenario === "textedit-rich-bold" ? RICH : FILE], {
									timeout: 10000,
								});
								await opened.ready;
							} finally {
								opened.cancel();
							}
						}
						before = probe.read();
						trace = await startDisturbance(traceBinary);
						if (scenario === "textedit-save-sheet")
							activeOracle = await expectFile(`${dir}/saved-from-sheet.txt`, TARGET, 300000);
						for (const step of menuPlan(scenario)) {
							if (step.op === "assert-text") {
								const body = osa(
									'tell application "TextEdit" to get text of document "document.txt"',
								).trimEnd();
								if (body !== step.value) throw new Error(`checkpoint mismatch: ${body}`);
							} else await driver.step(step);
						}
						if (scenario === "textedit-save-sheet")
							row.pass =
								(await activeOracle.wait(10000)).pass &&
								readFileSync(`${dir}/saved-from-sheet.txt`, "utf8").trim() === TARGET;
						if (scenario === "textedit-alert-dismiss") {
							row.file_oracle = readFileSync(FILE, "utf8") === "do not save";
							row.body_oracle =
								osa('tell application "TextEdit" to get text of document "document.txt"').trimEnd() === TARGET;
							row.sheet_oracle = !osa(
								'tell application "System Events" to tell process "TextEdit" to get name of every sheet of front window',
							).includes("Save");
							row.pass = row.file_oracle && row.body_oracle && row.sheet_oracle;
						}
						if (scenario === "textedit-rich-bold") {
							const rtf = readFileSync(RICH, "utf8");
							row.file_oracle = rtf.includes(TARGET);
							row.bold_oracle = rtfTextIsBold(rtf, TARGET);
							row.pass = row.file_oracle && row.bold_oracle;
						}
						row.false_success = !row.pass && driver.allCallsSucceeded;
					} catch (error) {
						row.error = String(error);
					} finally {
						activeOracle?.cancel();
						activeOracle = undefined;
						row.e2e_seconds = driver.firstCallAt === null ? 0 : (performance.now() - driver.firstCallAt) / 1000;
						row.tool_only_seconds = driver.end_to_end_seconds;
						row.calls = driver.calls;
						row.tokens = driver.estimated_tokens;
						row.raw = driver.raw;
						if (before) {
							const after = probe.read();
							row.focus_disturbance = before.app !== after.app;
							row.pointer_disturbance = Math.hypot(before.x - after.x, before.y - after.y) > 2;
						}
						if (trace) {
							row.disturbance_trace = await trace.stop();
							row.focus_disturbance ||= row.disturbance_trace.activations.length > 0;
							row.pointer_disturbance ||= row.disturbance_trace.max_cursor_px > 2;
						}
						try {
							const titles =
								scenario === "textedit-save-sheet" ? ["Untitled", "saved-from-sheet.txt"] : [watchedTitle];
							for (const title of titles) {
								const closed = await subscribeWindow(observerBinary, title, true);
								try {
									osa(
										`tell application "TextEdit" to close (every document whose name is "${title}" or path is "${dir}/${title}") saving no`,
									);
									await closed.ready;
								} finally {
									closed.cancel();
								}
							}
							row.cleanup = { attempted: true, leftover: [] };
						} catch (error) {
							row.cleanup = { error: String(error) };
							stop = true;
						}
						report.results.push(row);
						persist();
						process.stdout.write(`${route} ${scenario} ${iteration}/${runs}: ${row.pass ? "PASS" : "FAIL"}\n`);
						if (row.cleanup.error) stop = true;
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
			rmSync(archive, { force: true });
		}
		closeSync(lock);
		rmSync(lockPath, { force: true });
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, halt);
	}
}
