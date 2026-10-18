import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const n of [1, 30]) {
	test(`#given ${n} paired attempts #when producing claims #then minimum coverage and missing reports stay explicit`, () => {
		const directory = mkdtempSync(join(tmpdir(), "cua-claims-test-"));
		try {
			const source = join(directory, "source.json");
			const output = join(directory, "claims.json");
			const row = {
				n,
				completion: { rate: 1, lower: 0.89, upper: 1 },
				false_success: { count: 0 },
				metric_observations: { cost: { observed: 0, missing: n } },
			};
			writeFileSync(
				source,
				JSON.stringify({
					provenance: [{ path: "raw.json", sha256: "fixture" }],
					per_task: { apple: { task: row }, cua: { task: row } },
					comparisons: {
						apple: {
							cua: {
								per_task: {
									task: {
										n,
										p95_ratio: { lower: 0.8, upper: 0.9 },
										completion_difference: { lower: 0, upper: 0.1 },
									},
								},
							},
						},
					},
				}),
			);
			execFileSync(
				process.execPath,
				[fileURLToPath(new URL("./claim-ledger.mjs", import.meta.url)), output, source],
				{ timeout: 10000 },
			);
			const report = JSON.parse(readFileSync(output, "utf8"));
			const cohort = report.cohorts[0];
			const result = cohort.tasks[0];
			assert.match(cohort.analysis_sha256, /^[a-f0-9]{64}$/);
			assert.equal(result.cohort_minimum_met, n === 30);
			assert.equal(result.claims.S1, n === 30 ? "FAIL" : "INCONCLUSIVE");
			assert.equal(result.claims.R1, n === 30 ? "PASS" : "INCONCLUSIVE");
			assert.equal(result.claims.R2, n === 30 ? "PASS" : "INCONCLUSIVE");
			assert.equal(result.claims.R1p, "INCONCLUSIVE");
			for (const key of ["F1", "F1p", "D1"]) assert.equal(result.claims[key], "INCONCLUSIVE");
			assert.equal(result.non_error_plan_oracle_disagreements.count, 0);
			assert.equal(result.metric_observations.cost.missing, n);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});
}
