import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { textAgentCleanup } from "./text-agent-cleanup.mjs";

const directory = realpathSync("/tmp/cua-bench");
const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();
const results = [];
for (const name of ["document.txt", "other.txt"]) {
	const path = `${directory}/${name}`;
	const predicate = `every document whose path is "${path}" or path is "/tmp/cua-bench/${name}"`;
	const before = Number(osa(`tell application "TextEdit" to count (${predicate})`));
	if (!Number.isInteger(before) || before < 0 || before > 1)
		throw new Error(`ambiguous owned document: ${path}: ${before}`);
	if (before === 1) osa(`tell application "TextEdit" to close (${predicate}) saving no`);
	const after = Number(osa(`tell application "TextEdit" to count (${predicate})`));
	results.push({ path, before, after, closure_attempted: before === 1 });
	if (after !== 0) throw new Error(`owned document remains: ${path}: ${after}`);
}
const cleanup = textAgentCleanup(results[0].after, results[1].after, null);
const remaining = osa('tell application "TextEdit" to get path of every document');
const report = {
	scope: "recovery after human TextEdit handoff",
	original: ".bench/v3/text-agent-non-cua-smoke.json",
	results,
	cleanup,
	remaining,
};
writeFileSync(".bench/v3/text-agent-handoff-cleanup.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
