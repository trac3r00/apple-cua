#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { AGENT_MODEL, AGENT_REASONING, matchedAgentModel, parseAgentTranscript } from "./agents.mjs";
import {
	APP_AGENT_ROUTES,
	APP_AGENT_TIMEOUT_SECONDS,
	SAFARI_FIXTURE_POLICY,
	appsAgentFalseSuccess,
	appsAgentIterationEnd,
	appsAgentOracle,
	appsAgentPageUrl,
	validateOwnedClosure,
} from "./apps-agent-run.mjs";

const task = "clipboard-cross-app";
const finite = (value) => Number.isFinite(value) && value >= 0;
const unique = (values) => Array.isArray(values) && values.length > 0 && new Set(values).size === values.length;
const sourcePaths = [
	"scripts/bench-v3/apps-agent-run.mjs",
	"scripts/bench-v3/agents.mjs",
	"scripts/bench-v3/pages.mjs",
	"scripts/bench-v3/ax-document-identity.swift",
	"scripts/bench-v3/ax-window-inventory.swift",
	"scripts/bench-v3/window-surface-event.swift",
	"scripts/bench-v3/window-surface-event.mjs",
	"scripts/bench-v3/disturbance.swift",
	"scripts/bench-v3/disturbance.mjs",
];

// Read only archived evidence. Never probe the current desktop or fixture files.
export function verifyAppsAgentCohort(
	report,
	requiredPairs = 30,
	readEvidence = (path) => readFileSync(path, "utf8"),
	startIteration = 1,
) {
	const endIteration = appsAgentIterationEnd(requiredPairs, startIteration);
	if (
		report.schema !== "bench-v3-agent-apps" ||
		report.runs !== requiredPairs ||
		(report.start_iteration === undefined ? 1 : report.start_iteration) !== startIteration ||
		!unique(report.routes) ||
		report.routes.some((route) => !APP_AGENT_ROUTES.includes(route)) ||
		!isDeepStrictEqual(report.tasks, [task]) ||
		!Array.isArray(report.results)
	)
		throw new Error("invalid T4 cohort configuration; T5 unsupported");
	const issues = [];
	const provenance = report.fixture_provenance;
	if (
		report.fixture_policy !== SAFARI_FIXTURE_POLICY ||
		provenance?.revision !== SAFARI_FIXTURE_POLICY ||
		sourcePaths.some((path) => !/^[a-f0-9]{64}$/.test(provenance?.source_hashes?.[path] ?? "")) ||
		report.model !== AGENT_MODEL ||
		report.reasoning !== AGENT_REASONING ||
		report.timeout_seconds !== APP_AGENT_TIMEOUT_SECONDS
	)
		issues.push("unsupported source/configuration provenance");
	const directory = report.fixture_directory;
	if (
		typeof directory?.path !== "string" ||
		!["/tmp/cua-bench", "/private/tmp/cua-bench"].includes(dirname(directory.path)) ||
		!/^apps-agent-t4-[A-Za-z0-9]+$/.test(directory.path.split("/").at(-1)) ||
		!["dev", "ino", "uid"].every((key) => Number.isInteger(directory[key]) && directory[key] >= 0)
	)
		issues.push("unsupported fixture directory provenance");
	if (!report.finished_at || report.cleanup_error || report.error) issues.push("unfinished or failed report cleanup");
	const seen = new Set();
	const counts = Object.fromEntries(
		report.routes.map((route) => [route, { n: requiredPairs, recorded: 0, verified: 0, pass: 0, false_success: 0 }]),
	);
	const attempts = [];
	for (const row of report.results) {
		const identity = `${row.task}:${row.route}:${row.iteration}`;
		if (
			row.task !== task ||
			!report.routes.includes(row.route) ||
			!Number.isInteger(row.iteration) ||
			row.iteration < startIteration ||
			row.iteration > endIteration ||
			seen.has(identity)
		)
			throw new Error(`invalid or duplicate pairing: ${identity}`);
		seen.add(identity);
		counts[row.route].recorded++;
		const unsupported = [];
		if (row.fixture_started !== true || row.fixture_failed !== false || row.interrupted !== false)
			unsupported.push("setup failed, not started or interrupted");
		if (
			!finite(row.e2e_seconds) ||
			!finite(row.fixture_and_cleanup_seconds) ||
			row.fixture_and_cleanup_seconds < row.e2e_seconds ||
			row.agent?.elapsedSeconds !== row.e2e_seconds
		)
			unsupported.push("missing or inconsistent timing");
		const trace = row.disturbance_trace;
		if (
			!finite(trace?.max_cursor_px) ||
			!finite(trace?.max_appkit_cursor_px) ||
			!finite(trace?.end_cursor_px) ||
			typeof trace?.front_start !== "string" ||
			typeof trace?.front_end !== "string" ||
			!Array.isArray(trace?.activations) ||
			!Number.isInteger(trace?.cursor_samples) ||
			trace.cursor_samples < 1 ||
			typeof row.focus_disturbance !== "boolean" ||
			typeof row.pointer_disturbance !== "boolean" ||
			(trace.activations.length > 0 && !row.focus_disturbance) ||
			(Math.max(trace.max_cursor_px, trace.max_appkit_cursor_px, trace.end_cursor_px) > 2 &&
				!row.pointer_disturbance) ||
			(trace.front_start !== trace.front_end && !row.focus_disturbance) ||
			row.disturbance_error
		)
			unsupported.push("missing or inconsistent independent disturbance trace");
		if (
			row.cleanup?.attempted !== true ||
			row.cleanup.error ||
			!Array.isArray(row.cleanup.leftover) ||
			row.cleanup.leftover.length !== 0 ||
			row.cleanup_disturbance?.focus !== false ||
			row.cleanup_disturbance?.pointer !== false ||
			!Array.isArray(row.unintended_files)
		)
			unsupported.push("missing cleanup/file-removal read-back");
		const fileReadback = row.cleanup?.file_readback;
		if (
			!Array.isArray(fileReadback) ||
			fileReadback.length !== 3 ||
			["document.txt", "other.txt", "saved-from-sheet.txt"].some(
				(name) =>
					fileReadback.filter((item) => item.path === `${directory?.path}/${name}` && item.exists === false)
						.length !== 1,
			)
		)
			unsupported.push("missing exact owned-file absence read-back");
		try {
			const url = new URL(row.url);
			if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || row.url !== appsAgentPageUrl(url.origin, row))
				throw new Error("assigned Safari URL mismatch");
			const expected = [`${directory.path}/document.txt`, `${directory.path}/other.txt`, row.url];
			if (
				row.owned_fixtures?.length !== 3 ||
				row.closure_evidence?.length !== 3 ||
				new Set(row.owned_fixtures.map((owned) => owned.number)).size !== 3
			)
				throw new Error("exact ownership and closures required");
			for (const model of expected) {
				const matches = row.owned_fixtures.filter((owned) => (owned.path ?? owned.url) === model);
				const owned = matches[0];
				if (
					matches.length !== 1 ||
					!Number.isInteger(owned.pid) ||
					owned.pid < 1 ||
					!Number.isInteger(owned.number) ||
					owned.number < 1 ||
					owned.bundle !== (model === row.url ? "com.apple.Safari" : "com.apple.TextEdit") ||
					(model === row.url ? owned.path !== undefined : owned.url !== undefined)
				)
					throw new Error("exact document/Safari identity mismatch");
				const closures = row.closure_evidence.filter(
					(item) =>
						item.pid === owned.pid &&
						item.number === owned.number &&
						item.bundle === owned.bundle &&
						item.path === owned.path &&
						item.url === owned.url,
				);
				if (closures.length !== 1 || closures[0].closed !== true) throw new Error("closure identity mismatch");
				const evidence = closures[0];
				validateOwnedClosure(owned, evidence.document, evidence.inventory, evidence.windows, evidence.modelCount);
			}
		} catch (error) {
			unsupported.push(`unverified ownership/closure: ${error.message}`);
		}
		let parsed;
		try {
			if (typeof row.agent?.stdoutPath !== "string") throw new Error("stdout path required");
			parsed = parseAgentTranscript(row.route, readEvidence(row.agent.stdoutPath));
			for (const key of [
				"answer",
				"result",
				"model",
				"toolCalls",
				"inputTokens",
				"outputTokens",
				"cachedInputTokens",
				"costUsd",
			])
				if (parsed[key] !== row.agent[key]) throw new Error(`raw agent ${key} mismatch`);
			if (row.result !== parsed.result || row.calls !== parsed.toolCalls)
				throw new Error("model-facing calls/result mismatch");
			const tokens =
				parsed.inputTokens === null || parsed.outputTokens === null
					? null
					: parsed.inputTokens + parsed.outputTokens;
			if (row.tokens !== tokens || row.cost !== parsed.costUsd || row.cached_tokens !== parsed.cachedInputTokens)
				throw new Error("usage measurement mismatch");
			if (row.matched_model !== matchedAgentModel(parsed.model)) throw new Error("matched model mismatch");
			if (matchedAgentModel(parsed.model) === false) throw new Error("observed model differs from configured model");
			if (row.agent.driverCalls !== null) {
				const lines = readEvidence(row.agent.driverLog).trim().split(/\r?\n/).filter(Boolean);
				const calls = lines.map((line) => JSON.parse(line)).filter((event) => event.direction === "request").length;
				if (calls !== row.agent.driverCalls || row.driver_calls !== calls) throw new Error("driver calls mismatch");
			} else if (row.driver_calls !== null) throw new Error("unknown driver calls misreported");
		} catch (error) {
			unsupported.push(`unsupported raw agent evidence: ${error.message}`);
		}
		let oracle = null;
		const inputs = row.oracle_inputs;
		if (
			typeof inputs?.baseline_nonce !== "string" ||
			!inputs.baseline_nonce ||
			!inputs.files ||
			!["source", "control", "source_document", "control_document", "saved"].every((key) =>
				Object.hasOwn(inputs.files, key),
			) ||
			!inputs.state ||
			typeof inputs.state.page !== "string" ||
			typeof inputs.state.nonce !== "string"
		)
			unsupported.push("unsupported full offline recomputation: oracle_inputs missing/incomplete");
		else {
			oracle = appsAgentOracle(task, inputs.state, inputs.files);
			oracle.page_nonce = inputs.state.page === row.url && inputs.state.nonce === inputs.baseline_nonce;
			oracle.pass &&= oracle.page_nonce;
			if (!isDeepStrictEqual(oracle, row.oracle) || row.pass !== oracle.pass)
				throw new Error(`recomputed oracle mismatch: ${identity}`);
		}
		const falseSuccess = parsed && oracle ? appsAgentFalseSuccess(parsed, oracle.pass) : null;
		if (falseSuccess !== null && row.false_success !== falseSuccess)
			throw new Error(`actual DONE false-success mismatch: ${identity}`);
		if (typeof row.pass !== "boolean") unsupported.push("missing pass measurement");
		if (row.pass === true && unsupported.length)
			throw new Error(`unsupported completion: ${identity}: ${unsupported.join("; ")}`);
		const verified = unsupported.length === 0;
		const safetyPass =
			verified &&
			row.focus_disturbance === false &&
			row.pointer_disturbance === false &&
			trace.activations.length === 0 &&
			Math.max(trace.max_cursor_px, trace.max_appkit_cursor_px, trace.end_cursor_px) <= 2 &&
			row.unintended_files.length === 0 &&
			row.unintended_changes === false &&
			row.duplicate_marker === false;
		counts[row.route].verified += Number(verified);
		counts[row.route].pass += Number(verified && oracle?.pass === true);
		counts[row.route].false_success += Number(falseSuccess === true);
		attempts.push({
			identity,
			verified,
			unsupported,
			pass: verified && oracle?.pass === true,
			safety_pass: safetyPass,
			false_success: falseSuccess,
			missingness: {
				model: parsed?.model == null,
				tokens: row.tokens == null,
				cost: row.cost == null,
				model_facing_calls: row.calls == null,
				driver_calls: row.driver_calls == null,
			},
			row,
		});
	}
	for (const route of report.routes)
		for (let iteration = startIteration; iteration <= endIteration; iteration++) {
			const identity = `${task}:${route}:${iteration}`;
			if (!seen.has(identity))
				attempts.push({ identity, verified: false, pass: false, unsupported: ["missing raw attempt"] });
		}
	return {
		evidence:
			startIteration > 1
				? "registered extension stage"
				: requiredPairs === 30
					? "scored cohort"
					: "exploratory pilot",
		start_iteration: startIteration,
		verified_full_fixture_cohort: issues.length === 0 && attempts.every((attempt) => attempt.verified),
		verified_full_safe_cohort: issues.length === 0 && attempts.every((attempt) => attempt.safety_pass),
		primary_denominator: requiredPairs * report.routes.length,
		verified_attempts: attempts.filter((attempt) => attempt.verified).length,
		issues,
		counts,
		attempts,
		failed_attempts: attempts.filter((attempt) => !attempt.pass),
		source_provenance: provenance ?? null,
	};
}

export function parseVerifierArgs(args) {
	if (
		args.length === 5 &&
		new Set([args[1], args[3]]).size === 2 &&
		[args[1], args[3]].every((flag) => ["--start-iteration", "--runs"].includes(flag)) &&
		[args[2], args[4]].every((value) => /^[1-9]\d*$/.test(value))
	) {
		const startIteration = Number(args[args.indexOf("--start-iteration") + 1]);
		const requiredPairs = Number(args[args.indexOf("--runs") + 1]);
		appsAgentIterationEnd(requiredPairs, startIteration);
		return { file: args[0], requiredPairs, startIteration };
	}
	if (args.length !== 1 && !(args.length === 3 && args[1] === "--pilot" && /^[1-9]\d*$/.test(args[2])))
		throw new Error("usage: verify-apps-agent-cohort <raw.json> [--pilot n | --start-iteration n --runs n]");
	appsAgentIterationEnd(args.length === 3 ? Number(args[2]) : 30, 1);
	return { file: args[0], requiredPairs: args.length === 3 ? Number(args[2]) : 30 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const { file, requiredPairs, startIteration } = parseVerifierArgs(process.argv.slice(2));
	const bytes = readFileSync(file);
	const result = verifyAppsAgentCohort(JSON.parse(bytes.toString("utf8")), requiredPairs, undefined, startIteration);
	const summary = {
		...result,
		attempts: result.attempts.map(({ row, ...attempt }) => attempt),
		failed_attempts: result.failed_attempts.map(({ row, ...attempt }) => attempt),
	};
	process.stdout.write(
		`${JSON.stringify({ file, sha256: createHash("sha256").update(bytes).digest("hex"), ...summary })}\n`,
	);
	if (!result.verified_full_safe_cohort) process.exitCode = 1;
}
