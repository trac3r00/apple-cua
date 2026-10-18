import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { McpClient } from "../bench-v2/client.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { subscribeWindow } from "./window-event.mjs";

export function acquirePolicyLock(root) {
	return openSync(resolve(root, ".run.lock"), "wx");
}

export function policyOutcome(response, before, after, error = null) {
	const text = `${JSON.stringify(response)} ${error ?? ""}`;
	const payloads = [response, response?.structuredContent];
	for (const block of response?.content ?? []) {
		if (block.type !== "text") continue;
		try {
			payloads.push(JSON.parse(block.text));
		} catch {
			/* Non-JSON diagnostics remain in the raw response. */
		}
	}
	const refused =
		error !== null ||
		payloads.some(
			(body) =>
				body?.isError === true ||
				body?.ok === false ||
				body?.refused === true ||
				body?.status === "refused" ||
				body?.status === "needs_user",
		);
	const explicitDenial =
		refused &&
		/needs your approval|not approved|needs-approval|permission_denied|permission denied|app_not_approved/i.test(
			text,
		);
	return {
		pass: explicitDenial && before === after,
		explicit_denial: explicitDenial,
		input_landed: before !== after,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const runs = Number(process.argv[2] ?? 30);
	const output = resolve(process.argv[3] ?? ".bench/v3/policy-30.json");
	if (!Number.isInteger(runs) || runs < 1) throw new Error("invalid runs");
	if (isScreenLocked()) throw new Error("screen locked");
	const root = fileURLToPath(new URL("../..", import.meta.url));
	mkdirSync("/tmp/cua-bench", { recursive: true });
	const dir = mkdtempSync("/tmp/cua-bench/policy-");
	const file = `${dir}/denied.txt`;
	const observer = `${dir}/observer`;
	const traceBinary = `${dir}/trace`;
	const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trimEnd();
	const client = new McpClient({
		command: process.execPath,
		args: [`${root}/packages/mcp/dist/server.js`],
		env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "", APPLE_CUA_DELIVERY: "background" },
		timeoutMs: 15000,
	});
	const report = {
		schema: "bench-v3",
		runs,
		scope: "apple scoped app-policy conformance; not a paired superiority comparison",
		availability: { cua: "Scoped policy runtime not configured; existing standard daemon is not a denial fixture." },
		results: [],
	};
	let stopped = false;
	let owned = false;
	let cleanupVerified = false;
	let leftoverDocuments = null;
	const halt = () => {
		stopped = true;
		client.stop();
	};
	for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, halt);
	const persist = () => {
		mkdirSync(resolve(output, ".."), { recursive: true });
		writeFileSync(output, JSON.stringify(report, null, 2));
	};
	const lock = acquirePolicyLock("/tmp/cua-bench");
	try {
		for (const [source, binary] of [
			["window-event.swift", observer],
			["disturbance.swift", traceBinary],
		])
			execFileSync("swiftc", [`${root}/scripts/bench-v3/${source}`, "-o", binary], { timeout: 60000 });
		writeFileSync(file, "unchanged policy sentinel");
		const opened = await subscribeWindow(observer, "denied.txt");
		try {
			execFileSync("open", ["-g", "-e", file], { timeout: 10000 });
			owned = true;
			await opened.ready;
		} finally {
			opened.cancel();
		}
		await client.start();
		for (let iteration = 1; iteration <= runs; iteration++) {
			if (stopped || isScreenLocked()) throw new Error("stopped or locked");
			const before = osa(
				`tell application "TextEdit" to get text of (first document whose path is "${file}" or path is "${file.replace("/tmp/", "/private/tmp/")}")`,
			);
			const trace = await startDisturbance(traceBinary);
			const row = { iteration, route: "apple", scenario: "policy-denied", pass: false };
			const start = performance.now();
			try {
				row.raw = await client.callTool("run_script", {
					code: 'await apple.app("TextEdit").type("forbidden policy marker");',
					timeout_ms: 10000,
				});
			} catch (error) {
				row.error = String(error);
			} finally {
				row.e2e_seconds = (performance.now() - start) / 1000;
				row.before = before;
				row.after = osa(
					`tell application "TextEdit" to get text of (first document whose path is "${file}" or path is "${file.replace("/tmp/", "/private/tmp/")}")`,
				);
				Object.assign(row, policyOutcome(row.raw, row.before, row.after, row.error));
				row.file_unchanged = readFileSync(file, "utf8") === "unchanged policy sentinel";
				row.pass &&= row.file_unchanged;
				row.calls = 1;
				row.disturbance_trace = await trace.stop();
				row.focus_disturbance = row.disturbance_trace.activations.length > 0;
				row.pointer_disturbance = row.disturbance_trace.max_cursor_px > 2;
				report.results.push(row);
				persist();
				process.stdout.write(`apple policy-denied ${iteration}/${runs}: ${row.pass ? "PASS" : "FAIL"}\n`);
			}
			if (row.input_landed) throw new Error("unexpected input during denied-policy trial");
		}
		report.finished_at = new Date().toISOString();
	} finally {
		halt();
		try {
			if (owned) {
				const closed = await subscribeWindow(observer, "denied.txt", true);
				try {
					osa(
						`tell application "TextEdit" to close (every document whose path is "${file}" or path is "${file.replace("/tmp/", "/private/tmp/")}") saving no`,
					);
					await closed.ready;
					leftoverDocuments = Number(
						osa(
							`tell application "TextEdit" to count (every document whose path is "${file}" or path is "${file.replace("/tmp/", "/private/tmp/")}")`,
						),
					);
					cleanupVerified = leftoverDocuments === 0;
				} finally {
					closed.cancel();
				}
			}
		} finally {
			try {
				if (cleanupVerified) rmSync(dir, { recursive: true });
				report.cleanup = {
					verified: cleanupVerified,
					leftover_documents: leftoverDocuments,
					fixture_removed: cleanupVerified && !existsSync(dir),
				};
				persist();
			} finally {
				for (const signal of ["SIGINT", "SIGTERM"]) process.removeListener(signal, halt);
				closeSync(lock);
				rmSync("/tmp/cua-bench/.run.lock");
			}
		}
	}
}
