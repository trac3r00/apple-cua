import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BROWSER_ROUTES = [
	"omo-apple",
	"omo-cua",
	"omo-native",
	"codex-native",
	"codex-apple",
	"codex-cua",
	"omo-attached-browser",
];
export const BROWSER_TASKS = ["form", "scroll-link", "injection"];

export function interruptedBrowserFailureVerified(row, recoveries = []) {
	if (row.interrupted !== true || row.pass !== false || row.agent) return false;
	return recoveries.some(
		(evidence) =>
			row.url &&
			evidence.url === row.url &&
			evidence.iteration === row.iteration &&
			evidence.task === row.task &&
			evidence.route === row.route &&
			typeof evidence.verified_at === "string" &&
			Number.isFinite(Date.parse(evidence.verified_at)) &&
			(evidence.runtime_restart === true ||
				(evidence.harness_process_exit === true && evidence.error_code === "ERR_HTTP_HEADERS_SENT")) &&
			evidence.terminal_failure === true &&
			evidence.old_agent_process_absent === true &&
			evidence.registry_sessions === 0 &&
			evidence.matching_fixture_tabs === 0,
	);
}

export function browserCleanupVerified(row, recoveries = []) {
	if (interruptedBrowserFailureVerified(row, recoveries)) return true;
	if (row.cleanup?.managed_session_stopped === true && !row.cleanup.error) return true;
	if (row.cleanup?.error !== "BskRpcError: session is not registered") return false;
	return recoveries.some(
		(evidence) =>
			row.url &&
			row.managed_session &&
			row.browser_instance &&
			evidence.url === row.url &&
			evidence.managed_session === row.managed_session &&
			evidence.browser_instance === row.browser_instance &&
			typeof evidence.verified_at === "string" &&
			Number.isFinite(Date.parse(evidence.verified_at)) &&
			evidence.registry_session_absent === true &&
			evidence.matching_fixture_tabs === 0,
	);
}

/** Completion is about attempted slots and cleanup, never winning the task. */
export function matrixGate(
	report,
	{
		runs = 30,
		routes = BROWSER_ROUTES,
		tasks = BROWSER_TASKS,
		cleanupRecoveries = report.cleanup_recoveries ?? [],
	} = {},
) {
	const failures = [];
	if (report.runs !== runs) failures.push("run count mismatch");
	if (
		!Array.isArray(report.routes) ||
		report.routes.length !== routes.length ||
		routes.some((route) => !report.routes.includes(route))
	)
		failures.push("route set mismatch");
	if (!report.summary) failures.push("terminal summary missing");
	const rows = report.results ?? [];
	if (rows.length !== runs * routes.length * tasks.length) failures.push("attempt count mismatch");
	const slots = new Set();
	for (const row of rows) {
		const key = `${row.iteration}:${row.task}:${row.route}`;
		if (slots.has(key)) failures.push(`duplicate slot ${key}`);
		slots.add(key);
		if (
			!Number.isInteger(row.iteration) ||
			row.iteration < 1 ||
			row.iteration > runs ||
			!routes.includes(row.route) ||
			!tasks.includes(row.task)
		)
			failures.push(`unexpected slot ${key}`);
		if (row.interrupted !== false && !interruptedBrowserFailureVerified(row, cleanupRecoveries))
			failures.push(`unfinished slot ${key}`);
		if (!browserCleanupVerified(row, cleanupRecoveries)) failures.push(`cleanup unverified ${key}`);
	}
	return { ready: failures.length === 0, failures };
}

/** Exploratory single-block handoff: missing safety evidence never means zero. */
export function fixtureSmokeGate(report, kind) {
	if (!["remaining", "cancellation", "text-faults"].includes(kind)) throw new Error("unsupported fixture smoke kind");
	const cancellation = kind === "cancellation";
	let tasks = ["cancellation"];
	if (kind === "remaining") tasks = ["safari-heading", "settings-version", "two-apps-one-task"];
	if (kind === "text-faults") tasks = ["stale-token-recovery", "textedit-window-reopened", "server-killed"];
	const expected = new Set(tasks.flatMap((task) => ["apple", "cua"].map((route) => `${task}:${route}`)));
	const failures = [];
	if (report.runs !== 1) failures.push("run count mismatch");
	if (!report.finished_at) failures.push("terminal timestamp missing");
	const rows = report.results ?? [];
	if (rows.length !== expected.size) failures.push("attempt count mismatch");
	for (const row of rows) {
		const key = `${cancellation ? "cancellation" : row.scenario}:${row.route}`;
		if (row.iteration !== 1 || !expected.delete(key) || row.not_started)
			failures.push(`unexpected or unstarted slot ${key}`);
		const leftovers = cancellation ? row.cleanup?.leftover_windows : row.cleanup?.leftover;
		if (!Array.isArray(leftovers) || leftovers.length || row.cleanup?.error)
			failures.push(`cleanup unverified ${key}`);
		if (cancellation && (row.trial_completed !== true || row.cleanup?.target_file_removed !== true))
			failures.push(`observer or fixture removal unverified ${key}`);
		if (kind === "text-faults" && row.cleanup?.attempted !== true) failures.push(`cleanup not attempted ${key}`);
	}
	if (expected.size) failures.push("missing slots");
	return { ready: failures.length === 0, failures };
}

export function policySmokeGate(report) {
	const failures = [];
	if (report.runs !== 1 || !report.finished_at) failures.push("nonterminal policy pilot");
	const rows = report.results ?? [];
	if (
		rows.length !== 1 ||
		rows[0]?.iteration !== 1 ||
		rows[0]?.route !== "apple" ||
		rows[0]?.scenario !== "policy-denied"
	)
		failures.push("policy slot mismatch");
	if (
		report.cleanup?.verified !== true ||
		report.cleanup?.leftover_documents !== 0 ||
		report.cleanup?.fixture_removed !== true
	)
		failures.push("policy cleanup unverified");
	return { ready: failures.length === 0, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const path = process.argv[2];
	if (!path) throw new Error("usage: matrix-gate <browser-agent-report.json>");
	const report = JSON.parse(readFileSync(path, "utf8"));
	const kind = process.argv[3];
	let result;
	if (kind === "policy") result = policySmokeGate(report);
	else result = kind ? fixtureSmokeGate(report, kind) : matrixGate(report);
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.ready) process.exitCode = 1;
}
