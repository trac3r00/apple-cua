import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectBrowserSkill } from "/Users/bob/.bun/install/global/node_modules/omo-ai/plugin/skills/browser/runtime/omowright/index.js";
import { startDisturbance } from "./disturbance.mjs";
import { startPages } from "./pages.mjs";
import { mulberry32, shuffle } from "./stats.mjs";

const runs = Number(process.argv[2] ?? 30);
const output = resolve(process.argv[3] ?? ".bench/v3/attached-30.json");
if (!Number.isInteger(runs) || runs < 1) throw new Error("invalid runs");
const report = {
	schema: "bench-v3",
	seed: 20261009,
	scope: "actual OmO attached-browser driver; not matched Safari comparison",
	results: [],
};
mkdirSync(resolve(output, ".."), { recursive: true });
mkdirSync("/tmp/cua-bench", { recursive: true });
const pages = await startPages();
const traceBinary = "/tmp/cua-bench/attached-trace-v3";
execFileSync("swiftc", [fileURLToPath(new URL("./disturbance.swift", import.meta.url)), "-o", traceBinary], {
	timeout: 60000,
});
const random = mulberry32(report.seed);
let active;
let stopped = false;
const halt = () => {
	stopped = true;
};
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, halt);
try {
	for (let iteration = 1; iteration <= runs; iteration++)
		for (const kind of shuffle(["form", "scroll", "delayed"], random)) {
			if (stopped) throw new Error("stopped");
			const row = { iteration, route: "omo-attached-browser", scenario: `browser-${kind}`, pass: false, calls: 0 };
			const url = `${pages.base}/page?kind=${kind}&attempt=${crypto.randomUUID()}`;
			let started;
			let trace;
			try {
				trace = await startDisturbance(traceBinary);
				active = await connectBrowserSkill({
					name: `Bench-${crypto.randomUUID()}`,
					focused: false,
					width: 1200,
					height: 800,
				});
				row.browser_instance = active.browserInstanceId;
				row.managed_session = active.sessionId;
				const loaded = pages.waitFor(url, (state) => Boolean(state?.nonce));
				await active.navigate(url, { waitUntil: "load", timeoutMs: 10000 });
				if (!(await loaded)) throw new Error("fixture did not report load");
				if (kind === "delayed" && !(await pages.waitFor(url, (state) => state?.ready)))
					throw new Error("field did not render");
				const outcome = pages.waitFor(url, (state) =>
					kind === "scroll" ? state?.hash === "#destination" : state?.field === "Bench-v2 marker 8c52",
				);
				started = performance.now();
				await active.observe({ maxTokens: 2000 });
				row.calls++;
				if (kind === "scroll") {
					await active.scrollTo("#link");
					row.calls++;
					await active.click("#link");
					row.calls++;
				} else {
					await active.click("#code");
					row.calls++;
					await active.fill("#code", "Bench-v2 marker 8c52", { clearBefore: true });
					row.calls++;
				}
				row.pass = await outcome;
				row.e2e_seconds = (performance.now() - started) / 1000;
				row.non_error_plan_oracle_disagreement = !row.pass;
				row.tokens = null;
				row.cost = null;
				if (iteration === 1) {
					const capture = await active.screenshot();
					const artifact = `${output}.${kind}.png`;
					writeFileSync(artifact, capture.buffer);
					row.screenshot = artifact;
				}
			} catch (error) {
				row.error = String(error);
				if (/BrowserUserStoppedError|user_aborted|permission_denied|BrowserActionDeclinedError/.test(String(error)))
					stopped = true;
			} finally {
				row.e2e_seconds ??= started === undefined ? null : (performance.now() - started) / 1000;
				row.page_state = pages.state(url) ?? null;
				try {
					await active?.stop();
					row.cleanup = { managed_session_stopped: true };
				} catch (error) {
					row.cleanup = { error: String(error) };
					stopped = true;
				}
				active = undefined;
				if (trace) {
					row.disturbance_trace = await trace.stop();
					row.focus_disturbance = row.disturbance_trace.activations.length > 0;
					row.pointer_disturbance = row.disturbance_trace.max_cursor_px > 2;
				}
				report.results.push(row);
				mkdirSync(resolve(output, ".."), { recursive: true });
				writeFileSync(output, JSON.stringify(report, null, 2));
				process.stdout.write(`omo-attached ${kind} ${iteration}/${runs}: ${row.pass ? "PASS" : "FAIL"}\n`);
			}
		}
} finally {
	await active?.stop();
	await pages.close();
	for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, halt);
}
