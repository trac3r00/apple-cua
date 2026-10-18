import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Exact task-owned paths from the stopped run's independent document inventory.
const prefix = "/private/var/folders/y0/mkpd4qc10l7259st4ng4s0xc0000gn/T/cua-cancellation-pilot-";
const owned = [
	["pBjJmx", 83008],
	["MSz1rT", 82814],
	["1ve9Na", 82626],
	["9SN6bf", 82400],
	["p9ovTq", 82233],
	["n7eM02", 82078],
	["VuhEwM", 81924],
	["PlfTpy", 79096],
	["jYCAz7", 78866],
	["Y3yE6k", 71480],
];
const osa = (body) => execFileSync("osascript", ["-e", body], { encoding: "utf8", timeout: 10000 }).trim();
const results = [];
for (const [directory, pid] of owned) {
	const path = `${prefix}${directory}/cancel-${pid}.txt`;
	const predicate = `every document whose path is "${path}"`;
	const before = Number(osa(`tell application "TextEdit" to count (${predicate})`));
	if (before !== 1) throw new Error(`owned document is missing or ambiguous: ${path}: ${before}`);
	osa(`tell application "TextEdit" to close (${predicate}) saving no`);
	const after = Number(osa(`tell application "TextEdit" to count (${predicate})`));
	results.push({ path, before, after, closed: after === 0 });
	if (after !== 0) throw new Error(`owned closure failed: ${path}`);
}
const remaining = osa('tell application "TextEdit" to get path of every document');
writeFileSync(".bench/v3/cancellation-cleanup-recovery.json", `${JSON.stringify({ results, remaining }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ closed: results.length, remaining })}\n`);
