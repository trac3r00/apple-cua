import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { analyzeAttempts } from "./analysis.mjs";

const [destination, ...sources] = process.argv.slice(2);
if (!destination || !sources.length)
	throw new Error("usage: save-analysis <output.json> <raw.json> [additional-raw.json]");
const rows = [];
const provenance = [];
const pairedIdentities = new Set();
for (const source of sources) {
	const bytes = readFileSync(source);
	const raw = JSON.parse(bytes.toString("utf8"));
	if (!Array.isArray(raw.results)) throw new Error(`missing results: ${source}`);
	provenance.push({ path: resolve(source), sha256: createHash("sha256").update(bytes).digest("hex") });
	for (const row of raw.results) {
		const route = row.route ?? row.engine ?? row.variant;
		const task = row.task ?? row.scenario;
		const iteration = row.attempt_id ? null : (row.iteration ?? row.block);
		if (route != null && task != null && iteration != null) {
			const identity = JSON.stringify([route, task, iteration]);
			if (pairedIdentities.has(identity)) throw new Error(`duplicate paired identity: ${identity} in ${source}`);
			pairedIdentities.add(identity);
		}
		rows.push({
			...row,
			iteration: row.attempt_id ? null : row.iteration,
		});
	}
}
const report = { provenance, ...analyzeAttempts(rows, { seed: 20261009, resamples: 10000 }) };
mkdirSync(dirname(resolve(destination)), { recursive: true });
writeFileSync(destination, JSON.stringify(report, null, 2));
process.stdout.write(`Analysis: ${destination}\n`);
