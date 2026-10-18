import { readFileSync } from "node:fs";
import { analyzeAttempts } from "./analysis.mjs";

const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: analyze-results <raw-results.json> [additional-artifacts.json]");
const rows = [];
for (const file of files) {
	const report = JSON.parse(readFileSync(file, "utf8"));
	if (!Array.isArray(report.results)) throw new Error(`missing results: ${file}`);
	for (const row of report.results) {
		rows.push({
			...row,
			// Interrupted unmatched attempts stay in all-attempt primary rates and latency.
			// They do not masquerade as a completed paired block.
			iteration: row.attempt_id ? null : row.iteration,
			source: file,
		});
	}
}
process.stdout.write(`${JSON.stringify(analyzeAttempts(rows), null, 2)}\n`);
