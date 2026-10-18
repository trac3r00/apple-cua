import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accountPayload } from "../bench-v2/metrics.mjs";
import { analyzeAttempts } from "./analysis.mjs";

const [
	source = ".bench/v3/calculator-fresh-process-30.json",
	destination = ".bench/v3/calculator-fresh-process-token-sensitivity-analysis.json",
] = process.argv.slice(2);
const bytes = readFileSync(source);
const raw = JSON.parse(bytes.toString("utf8"));
if (!Array.isArray(raw.results)) throw new Error("Missing calculator attempts");
const corrections = [];
const rows = raw.results.map((row) => {
	if (row.scenario !== "calculator-add" || !Array.isArray(row.raw))
		throw new Error("Expected retained calculator call payloads");
	let estimate = 0;
	let images = 0;
	for (const entry of row.raw) {
		if (!entry.result) continue;
		const payload = accountPayload(entry.result);
		estimate += payload.estimated_tokens;
		images += payload.image_tokens;
	}
	if (row.tokens !== estimate + images)
		throw new Error("Recorded token field does not match the audited producer bug");
	corrections.push({
		iteration: row.iteration,
		route: row.route,
		recorded_tokens: row.tokens,
		single_count_estimate: estimate,
		excess_image_estimate: images,
	});
	return { ...row, tokens: estimate };
});
const report = {
	provenance: [{ path: resolve(source), sha256: createHash("sha256").update(bytes).digest("hex") }],
	analysis_source_hashes: Object.fromEntries(
		["./calculator-token-sensitivity.mjs", "./analysis.mjs", "./stats.mjs", "../bench-v2/metrics.mjs"].map((path) => {
			const file = fileURLToPath(new URL(path, import.meta.url));
			return [file, createHash("sha256").update(readFileSync(file)).digest("hex")];
		}),
	),
	metric_adjustment: {
		scope: "Supplemental payload-estimate sensitivity only; original raw and task scoring remain unchanged",
		tokens: "Response UTF-8 bytes / 4 plus image area estimate once; not actual LLM usage or billed cost",
		false_success: "Driver non-error plan/oracle disagreement, not an actual task-success report",
		corrections,
	},
	...analyzeAttempts(rows, { seed: 20261009, resamples: 10000 }),
};
writeFileSync(destination, JSON.stringify(report, null, 2));
process.stdout.write(`Supplemental calculator payload analysis: ${destination}\n`);
