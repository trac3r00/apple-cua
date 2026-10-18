import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mulberry32, shuffle } from "./stats.mjs";

export const cancellationFixtureRoot = (directory) => realpathSync(directory);
export const hostTimestampNs = (milliseconds = Date.now()) => (BigInt(milliseconds) * 1000000n).toString();

export async function settleResponse(pending) {
	try {
		return { kind: "response", value: await pending };
	} catch (error) {
		return { kind: "error", error: String(error) };
	}
}

export function cancellationAcceptance(result) {
	return result.kind === "error" && /"code"\s*:\s*-32800\b/.test(result.error) ? "accepted" : "unknown";
}

export function dispatchCancelledCall(client, dispatch) {
	const requestId = client.nextId;
	const response = settleResponse(dispatch());
	const notificationAtHostNs = hostTimestampNs();
	const notification = {
		jsonrpc: "2.0",
		method: "notifications/cancelled",
		params: { requestId, reason: "benchmark cancellation" },
	};
	client.child.stdin.write(`${JSON.stringify(notification)}\n`);
	return { requestId, response, notificationAtHostNs };
}

export function relativeEvents(events, cancelledAt) {
	return events.map((event) => ({
		...event,
		relative_to_cancel_ns: (BigInt(event.host_time_ns) - BigInt(cancelledAt)).toString(),
	}));
}

export async function cleanupFixture(probe, close, file, title, closed) {
	close();
	await closed;
	const matches = probe.snapshot().windows.filter((window) => window.owner === "TextEdit" && window.title === title);
	if (matches.length) throw new Error("owned window remains");
	rmSync(file);
	return { target_file_removed: true };
}

async function main() {
	const root = fileURLToPath(new URL("../..", import.meta.url));
	const output = resolve(process.argv[2] ?? ".bench/v3/cancellation-mutation-30.json");
	const runs = Number(process.argv[3] ?? 30);
	if (!Number.isInteger(runs) || runs < 1) throw new Error("invalid runs");
	mkdirSync(dirname(output), { recursive: true });
	const report = {
		scope: "mutation cancellation; independent AX arrival/read-back, not dispatch-time evidence",
		seed: 20261009,
		runs,
		fixture_revision: "canonical-directory-and-positive-preclosure-identity",
		source_sha256: Object.fromEntries(
			[
				"cancellation-run.mjs",
				"cancellation-observer-pilot.mjs",
				"cancellation-fixture.mjs",
				"cancellation-events.swift",
			].map((name) => [
				name,
				createHash("sha256")
					.update(readFileSync(`${root}/scripts/bench-v3/${name}`))
					.digest("hex"),
			]),
		),
		results: [],
	};
	const random = mulberry32(report.seed);
	let active;
	let stopped = false;
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		process.once(signal, () => {
			stopped = true;
			active?.kill("SIGINT");
		});
	}
	const persist = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
	for (let iteration = 1; iteration <= runs && !stopped; iteration++) {
		for (const route of shuffle(["apple", "cua"], random)) {
			if (stopped) break;
			const artifact = `${output}.${iteration}.${route}.json`;
			const started = performance.now();
			const row = { iteration, route, artifact };
			try {
				active = spawn(
					"node",
					[
						`${root}/scripts/bench-v3/cancellation-observer-pilot.mjs`,
						artifact,
						"--cancel",
						...(route === "cua" ? ["--cua"] : []),
					],
					{ stdio: ["ignore", "pipe", "pipe"] },
				);
				let stdout = "";
				let stderr = "";
				active.stdout.on("data", (chunk) => {
					stdout += chunk;
				});
				active.stderr.on("data", (chunk) => {
					stderr += chunk;
				});
				row.exit_code = await new Promise((resolve, reject) => {
					active.once("error", reject);
					active.once("close", resolve);
				});
				row.stdout = stdout;
				row.stderr = stderr;
				row.evidence = JSON.parse(readFileSync(artifact, "utf8"));
			} catch (error) {
				row.error = String(error);
			}
			row.seconds = (performance.now() - started) / 1000;
			row.interrupted = stopped;
			report.results.push(row);
			persist();
			process.stdout.write(
				`${route} cancellation ${iteration}/${runs}: ${row.evidence?.cancellation_verdict ?? row.evidence?.error ?? row.error}\n`,
			);
			if (row.evidence?.cleanup !== true) {
				stopped = true;
				report.stop_reason = "owned cleanup not independently verified";
			}
		}
	}
	report.finished_at = new Date().toISOString();
	report.stopped = stopped;
	persist();
	process.stdout.write(`Evidence: ${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
