import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { quantile, wilson } from "./stats.mjs";

export function summarizeCancellation(rows) {
	const expected = "cancel mutation marker ".repeat(512);
	const responses = rows
		.map((row) => row.evidence?.response_epoch_ms - row.evidence?.cancel?.epoch_ms)
		.filter(Number.isFinite);
	const responsive = rows.filter((row) => row.evidence?.responsive === true).length;
	const closed = rows.filter((row) => row.evidence?.cleanup_before === 1 && row.evidence?.cleanup === true).length;
	const completeBeforeCancel = rows.filter(
		(row) => row.evidence?.events?.find((event) => event.type === "change")?.value === expected,
	).length;
	return {
		n: rows.length,
		responsive: { count: responsive, wilson: wilson(responsive, rows.length) },
		verified_cleanup: { count: closed, wilson: wilson(closed, rows.length) },
		full_input_before_cancel: completeBeforeCancel,
		cancel_response_ms: {
			observed: responses.length,
			missing: rows.length - responses.length,
			median: quantile(responses, 0.5),
			p95: quantile(responses, 0.95),
		},
		responsiveness_observations: rows.filter((row) => typeof row.evidence?.responsive === "boolean").length,
		input_interruption_verdict: "INCONCLUSIVE",
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const input = resolve(process.argv[2]);
	const bytes = readFileSync(input);
	const data = JSON.parse(bytes);
	const report = {
		provenance: { path: input, sha256: createHash("sha256").update(bytes).digest("hex") },
		scope: "Protocol conformance; cancellation-response time is not task end-to-end latency or a superiority claim.",
		interpretation:
			"Complete input at cancellation does not exercise interruption. Event receipt is not dispatch time.",
		routes: Object.fromEntries(
			["apple", "cua"].map((route) => [
				route,
				summarizeCancellation(data.results.filter((row) => row.route === route)),
			]),
		),
	};
	const output = resolve(process.argv[3]);
	writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify(report)}\n`);
}
