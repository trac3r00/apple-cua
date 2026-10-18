import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { decideNonInferiority, decideRatioClaim } from "./stats.mjs";

const output = process.argv[2];
const sources = process.argv.slice(3);
if (!output || !sources.length) throw new Error("usage: claim-ledger <output> <corrected-analysis>...");
const cohorts = sources.map((path) => {
	const bytes = readFileSync(path);
	const analysis = JSON.parse(bytes.toString("utf8"));
	const tasks = Object.entries(analysis.per_task?.apple ?? {}).map(([task, route]) => {
		const paired = analysis.comparisons?.apple?.cua?.per_task?.[task];
		const sufficient = route.n >= 30 && (paired?.n ?? 0) >= 30;
		const population = route.completion;
		return {
			task,
			apple_n: route.n,
			cua_n: analysis.per_task?.cua?.[task]?.n ?? 0,
			paired_n: paired?.n ?? 0,
			cohort_minimum_met: sufficient,
			observed_completion: population,
			non_error_plan_oracle_disagreements: route.false_success,
			metric_observations: route.metric_observations,
			claims: {
				S1: sufficient ? decideRatioClaim(paired.p95_ratio) : "INCONCLUSIVE",
				R1: sufficient ? (population.rate >= 0.95 ? "PASS" : "FAIL") : "INCONCLUSIVE",
				R1p: sufficient
					? population.lower >= 0.95
						? "PASS"
						: population.upper < 0.95
							? "FAIL"
							: "INCONCLUSIVE"
					: "INCONCLUSIVE",
				R2: sufficient ? decideNonInferiority(paired.completion_difference) : "INCONCLUSIVE",
				F1: "INCONCLUSIVE",
				F1p: "INCONCLUSIVE",
				D1: "INCONCLUSIVE",
			},
			paired_completion_difference: paired?.completion_difference ?? null,
			paired_p95_ratio: paired?.p95_ratio ?? null,
		};
	});
	return {
		analysis: path,
		analysis_sha256: createHash("sha256").update(bytes).digest("hex"),
		raw_provenance: analysis.provenance,
		tasks,
	};
});
const report = {
	scope: "task-scoped driver claims; cohorts not pooled; full benchmark incomplete",
	note: "F1/F1p require actual success reports, not the driver proxy. D1 needs complete mutation/duplicate evidence and causal attribution, so this ledger makes no automated safety verdict.",
	cohorts,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Claim ledger: ${output}; ${cohorts.length} separate cohorts\n`);
