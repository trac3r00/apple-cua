import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { desktopProbe } from "../bench-v2/desktop.mjs";
import { matchedAgentModel, runAgentRoute } from "./agents.mjs";
import { appsAgentOracle } from "./apps-agent-run.mjs";
import { recordBrowserTrace } from "./browser-agent-run.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { expectFile } from "./file-oracle.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { textAgentCleanup } from "./text-agent-cleanup.mjs";
import { subscribeWindow } from "./window-event.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const runs = Number(process.argv[2] ?? 30);
const output = resolve(process.argv[3] ?? ".bench/v3/text-agent-30.json");
const routes = process.argv[4]?.split(",") ?? [
	"omo-apple",
	"omo-cua",
	"omo-native",
	"codex-apple",
	"codex-cua",
	"codex-native",
];
if (!Number.isInteger(runs) || runs < 1) throw new Error("invalid runs");
mkdirSync("/tmp/cua-bench", { recursive: true });
const dir = realpathSync("/tmp/cua-bench");
const lock = openSync(`${dir}/.run.lock`, "wx");
const abort = new AbortController();
const stop = () => abort.abort();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop);
const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 });
const clipboard = `${root}/scripts/bench-v2/clipboard.swift`;
const archive = `${dir}/agent-clipboard-${process.pid}.plist`;
const file = `${dir}/document.txt`;
const second = `${dir}/other.txt`;
let saved = false;
let probe;
const report = { schema: "bench-v3", seed: 20261009, scope: "matched multi-window text agent task", results: [] };
report.source_sha256 = Object.fromEntries(
	[
		"scripts/bench-v3/text-agent-run.mjs",
		"scripts/bench-v3/agents.mjs",
		"scripts/bench-v3/text-agent-cleanup.mjs",
		"packages/core/dist/platform/macos.js",
	].map((path) => [
		path,
		createHash("sha256")
			.update(readFileSync(`${root}/${path}`))
			.digest("hex"),
	]),
);
try {
	if (isScreenLocked()) throw new Error("screen locked");
	probe = desktopProbe();
	const initialMatches = probe
		.snapshot()
		.windows.filter((window) => window.owner === "TextEdit" && ["document.txt", "other.txt"].includes(window.title));
	const namedDocuments = Number(
		osa(
			'if application "TextEdit" is running then\n tell application "TextEdit" to count (every document whose name is "document.txt" or name is "other.txt")\nelse\n return 0\nend if',
		),
	);
	report.initial_fixture_check = textAgentCleanup(namedDocuments, 0, initialMatches);
	if (report.initial_fixture_check.leftover) throw new Error("fixture name already open");
	for (const [source, binary] of [
		["window-event.swift", "window-agent-v3"],
		["disturbance.swift", "trace-agent-v3"],
	])
		execFileSync("swiftc", [`${root}/scripts/bench-v3/${source}`, "-o", `${dir}/${binary}`], { timeout: 60000 });
	execFileSync("swift", [clipboard, "save", archive], { timeout: 60000 });
	saved = true;
	const random = mulberry32(report.seed);
	for (let iteration = 1; iteration <= runs; iteration++)
		for (const route of shuffle(routes, random)) {
			if (abort.signal.aborted || isScreenLocked()) throw new Error("stopped or locked");
			const row = { iteration, route, scenario: "textedit-two-windows", pass: false, false_success: false };
			let oracle;
			let trace;
			try {
				writeFileSync(file, "");
				writeFileSync(second, "other document unchanged");
				for (const [path, title] of [
					[file, "document.txt"],
					[second, "other.txt"],
				]) {
					const event = await subscribeWindow(`${dir}/window-agent-v3`, title);
					try {
						execFileSync("open", ["-g", "-e", path], { timeout: 10000 });
						await event.ready;
					} finally {
						event.cancel();
					}
				}
				oracle = await expectFile(file, "Bench-v2 marker 8c52", 310000);
				trace = await startDisturbance(`${dir}/trace-agent-v3`);
				const result = await runAgentRoute({
					route,
					signal: abort.signal,
					task: 'TextEdit has document.txt and other.txt open. Replace the whole contents of document.txt with exactly "Bench-v2 marker 8c52" and save it. Leave other.txt unchanged.',
				});
				row.agent = result;
				row.e2e_seconds = result.elapsedSeconds;
				// Retain client measurements even when an independent oracle subsequently fails.
				row.calls = result.toolCalls;
				row.driver_calls = result.driverCalls;
				row.help_requested = result.answer.includes("HELP_REQUEST:");
				row.tokens =
					result.inputTokens === null || result.outputTokens === null
						? null
						: result.inputTokens + result.outputTokens;
				row.cost = result.costUsd;
				row.matched_model = matchedAgentModel(result.model);
				row.timed_out = result.timedOut;
				// Oracle reads file bytes, never the agent's answer. A failed task need not wait its full cap.
				row.actual_file = readFileSync(file, "utf8");
				row.control_file = readFileSync(second, "utf8");
				row.actual_document = osa('tell application "TextEdit" to get text of document "document.txt"').replace(
					/\r?\n$/,
					"",
				);
				row.control_document = osa('tell application "TextEdit" to get text of document "other.txt"').replace(
					/\r?\n$/,
					"",
				);
				row.oracle = appsAgentOracle("textedit-two-windows", null, {
					source: row.actual_file,
					source_document: row.actual_document,
					control: row.control_file,
					control_document: row.control_document,
				});
				row.pass = row.oracle.pass;
				row.false_success = !row.pass && result.result === "DONE";
				// No minimal action plan was preregistered for this strengthened fixture.
				row.unnecessary_actions = null;
				row.duplicate_input = row.actual_file.split("Bench-v2 marker 8c52").length > 2;
				row.unintended_changes =
					row.control_file !== "other document unchanged" || row.control_document !== "other document unchanged";
			} catch (error) {
				row.error = String(error);
			} finally {
				oracle?.cancel();
				if (trace) {
					if (!(await recordBrowserTrace(row, trace))) abort.abort();
					if (row.focus_disturbance || row.pointer_disturbance) abort.abort();
				}
				try {
					const closing = [];
					try {
						for (const title of ["document.txt", "other.txt"])
							closing.push(await subscribeWindow(`${dir}/window-agent-v3`, title, true));
						osa(
							`tell application "TextEdit"\nclose (every document whose path is "${file}") saving no\nclose (every document whose path is "${second}") saving no\nclose (every document whose path is "/tmp/cua-bench/document.txt") saving no\nclose (every document whose path is "/tmp/cua-bench/other.txt") saving no\nend tell`,
						);
						await Promise.all(closing.map((event) => event.ready));
						row.cleanup = textAgentCleanup(
							Number(
								osa(
									`tell application "TextEdit" to count (every document whose path is "${file}" or path is "/tmp/cua-bench/document.txt")`,
								),
							),
							Number(
								osa(
									`tell application "TextEdit" to count (every document whose path is "${second}" or path is "/tmp/cua-bench/other.txt")`,
								),
							),
							probe
								.snapshot()
								.windows.filter(
									(window) =>
										window.owner === "TextEdit" && ["document.txt", "other.txt"].includes(window.title),
								),
						);
					} finally {
						for (const event of closing) event.cancel();
					}
				} catch (error) {
					row.cleanup = { error: String(error) };
				}
				report.results.push(row);
				mkdirSync(resolve(output, ".."), { recursive: true });
				writeFileSync(output, JSON.stringify(report, null, 2));
				process.stdout.write(`${route} textedit-two-windows ${iteration}/${runs}: ${row.pass ? "PASS" : "FAIL"}\n`);
			}
			if (row.cleanup.error || row.cleanup.leftover) throw new Error("cleanup failed");
		}
} finally {
	stop();
	probe?.close();
	try {
		if (saved) {
			execFileSync("swift", [clipboard, "restore", archive], { timeout: 60000 });
			rmSync(archive);
		}
	} finally {
		closeSync(lock);
		rmSync(`${dir}/.run.lock`);
	}
	for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, stop);
}
