import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pageCompleted } from "./browser-run.mjs";

const kinds = {
	"safari-form": "form",
	"safari-link": "link",
	"safari-scroll-link": "scroll",
	"safari-delayed-field": "delayed",
	"clipboard-cross-app": "cross-app",
};

export function verifyBrowserCohort(report, requiredPairs = 30) {
	if (!Number.isInteger(requiredPairs) || requiredPairs < 1) throw new Error("invalid required pair count");
	const startIteration = report.start_iteration ?? 1;
	if (!report.finished_at || report.runs !== requiredPairs || report.cleanup_error || report.error)
		throw new Error("incomplete browser cohort");
	if (!Number.isInteger(startIteration) || startIteration < 1) throw new Error("invalid stage start");
	const seen = new Set();
	const counts = {};
	for (const row of report.results) {
		const identity = `${row.scenario}:${row.route}:${row.iteration}`;
		const trace = row.disturbance_trace;
		if (
			!Object.hasOwn(kinds, row.scenario) ||
			!report.scenarios.includes(row.scenario) ||
			!["apple", "cua"].includes(row.route) ||
			!Number.isInteger(row.iteration) ||
			row.iteration < startIteration ||
			row.iteration >= startIteration + requiredPairs ||
			seen.has(identity) ||
			row.not_started ||
			row.fixture_failed ||
			typeof row.pass !== "boolean" ||
			!Number.isFinite(row.e2e_seconds)
		)
			throw new Error(`invalid attempt: ${identity}`);
		seen.add(identity);
		if (
			row.focus_disturbance !== false ||
			row.pointer_disturbance !== false ||
			!Number.isFinite(trace?.max_cursor_px) ||
			trace.max_cursor_px > 2 ||
			!Array.isArray(trace.activations) ||
			trace.activations.length !== 0
		)
			throw new Error(`unverified disturbance: ${identity}`);
		if (
			row.cleanup?.error !== null ||
			row.cleanup.leftover?.length !== 0 ||
			!Array.isArray(row.owned_windows) ||
			row.owned_windows.length !== (row.scenario === "clipboard-cross-app" ? 2 : 1) ||
			row.cleanup.closed?.length !== row.owned_windows.length ||
			(row.scenario === "clipboard-cross-app" && row.cleanup.fixture_removed !== true)
		)
			throw new Error(`unverified cleanup: ${identity}`);
		if (row.scenario === "clipboard-cross-app") {
			const text = row.owned_windows.find((window) => window.owner_bundle === "com.apple.TextEdit");
			if (
				text?.closure_readback?.document_count !== 0 ||
				text.closure_readback.ax_live !== false ||
				text.closure_readback.on_screen !== false
			)
				throw new Error(`unverified document/surface closure: ${identity}`);
		}
		if (
			typeof row.baseline_nonce !== "string" ||
			row.page_state?.nonce !== row.baseline_nonce ||
			(row.pass && !pageCompleted(kinds[row.scenario], row.page_state, row.baseline_nonce))
		)
			throw new Error(`unverified oracle: ${identity}`);
		counts[row.scenario] ??= { apple: { n: 0, pass: 0 }, cua: { n: 0, pass: 0 } };
		const group = counts[row.scenario];
		group[row.route].n++;
		group[row.route].pass += Number(row.pass);
	}
	for (const scenario of report.scenarios)
		if (counts[scenario]?.apple.n !== requiredPairs || counts[scenario]?.cua.n !== requiredPairs)
			throw new Error(`incomplete pairs: ${scenario}`);
	const failed_attempts = report.results
		.filter((row) => !row.pass)
		.map(({ scenario, route, iteration, error, page_state, false_success }) => ({
			scenario,
			route,
			iteration,
			error: error ?? null,
			page_state,
			false_success: false_success ?? null,
		}));
	return { counts, verified_attempts: seen.size, zero_recorded_disturbance: true, failed_attempts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const file = process.argv[2];
	if (!file) throw new Error("usage: verify-browser-cohort <raw>");
	const bytes = readFileSync(file);
	const requiredPairs = process.argv[3] === "--pilot" ? 1 : 30;
	const verified = verifyBrowserCohort(JSON.parse(bytes.toString("utf8")), requiredPairs);
	const result = {
		file,
		evidence: requiredPairs === 1 ? "exploratory pilot" : "scored cohort",
		sha256: createHash("sha256").update(bytes).digest("hex"),
		...verified,
	};
	process.stdout.write(`${JSON.stringify(result)}\n`);
}
