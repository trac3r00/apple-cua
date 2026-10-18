import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { agentPlanningMetrics } from "./analysis.mjs";
import { wilson } from "./stats.mjs";

export function recoveryCoverage(raw) {
	if (!Array.isArray(raw.results)) throw new Error("missing results");
	const groups = new Map();
	for (const row of raw.results) {
		const task = row.task ?? row.scenario;
		const route = row.route;
		if (typeof task !== "string" || typeof route !== "string") throw new Error("missing task or route");
		const key = JSON.stringify([task, route]);
		if (!groups.has(key)) groups.set(key, { task, route, rows: [] });
		groups.get(key).rows.push(row);
	}
	return [...groups.values()].map(({ task, route, rows }) => ({
		task,
		route,
		recorded: rows.length,
		metrics: Object.fromEntries(
			[
				"recovery_success",
				"duplicate_input",
				"human_help",
				"help_requested",
				"unnecessary_actions",
				"appropriate_help",
			].map((metric) => {
				const values = rows.map((row) => {
					if (metric === "duplicate_input") return row.duplicate_input ?? row.duplicate_marker;
					if (metric === "appropriate_help") return agentPlanningMetrics(row).appropriate_help;
					if (metric === "unnecessary_actions") return agentPlanningMetrics(row).unnecessary_actions;
					return row[metric];
				});
				const observed = values.filter((value) => typeof value === "boolean" || Number.isFinite(value));
				const positive = observed.filter((value) => value === true).length;
				return [
					metric,
					{
						observed: observed.length,
						missing: rows.length - observed.length,
						positive,
						observed_boolean_interval:
							observed.every((value) => typeof value === "boolean") && observed.length > 0
								? wilson(positive, observed.length)
								: null,
					},
				];
			}),
		),
	}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const sources = process.argv.slice(2);
	if (!sources.length) throw new Error("usage: node recovery-coverage.mjs <raw.json> [raw.json ...]");
	const reports = sources.map((source) => {
		const bytes = readFileSync(source);
		return {
			source,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			groups: recoveryCoverage(JSON.parse(bytes.toString("utf8"))),
		};
	});
	process.stdout.write(
		`${JSON.stringify(
			{
				scope: "Retained fields only; observed-subset intervals, not complete-cohort or paired verdicts",
				limitations: [
					"Assigned human_help fields are not independent manual-action measurements",
					"No retrospective minimal-plan length supplied",
					"Missing and unrecorded slots are not imputed; registered denominators must be reported separately",
					"No oracle, physical identity or cleanup validation performed",
				],
				reports,
			},
			null,
			2,
		)}\n`,
	);
}
