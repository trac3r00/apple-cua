import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient } from "../bench-v2/client.mjs";

/** Fragment requests at the transport boundary without changing server implementation. */
export async function probeProtocol(spec) {
	const client = new McpClient({ ...spec, timeoutMs: 10000 });
	const evidence = { fragmented: false, coalesced: false, cancellation: null, death: false };
	const started = performance.now();
	try {
		await client.start();
		const input = client.child.stdin;
		const original = input.write.bind(input);
		input.write = (data, callback) => {
			const bytes = Buffer.from(data);
			for (let i = 0; i < bytes.length; i++) original(bytes.subarray(i, i + 1));
			callback?.();
			return true;
		};
		const fragmented = await client.request("tools/list", {});
		evidence.fragmented = Array.isArray(fragmented.tools);
		input.write = original;
		const queued = [];
		input.write = (data, callback) => {
			queued.push({ data, callback });
			if (queued.length === 2) {
				original(queued.map((item) => item.data).join(""));
				for (const item of queued) item.callback?.();
			}
			return true;
		};
		const coalesced = await Promise.all([client.request("tools/list", {}), client.request("tools/list", {})]);
		evidence.coalesced = coalesced.every((result) => Array.isArray(result.tools));
		input.write = original;
		// Read-only cancellation: distinguishes transport responsiveness from mutation cancellation.
		const requestId = client.nextId;
		const pending = client.request("tools/list", {}).then(
			(value) => ({ outcome: "response", tools: value.tools?.length }),
			(error) => ({ outcome: "error", error: String(error) }),
		);
		original(
			`${JSON.stringify({
				jsonrpc: "2.0",
				method: "notifications/cancelled",
				params: { requestId, reason: "benchmark read-only cancellation" },
			})}\n`,
		);
		evidence.cancellation = {
			request: await pending,
			responsive: Array.isArray((await client.request("tools/list", {})).tools),
			input_after_cancel: null,
			scope: "read-only; mutation cancellation remains unmeasured",
		};
		const exited = once(client.child, "exit");
		client.child.kill("SIGKILL");
		await exited;
		try {
			await client.request("tools/list", {});
		} catch (error) {
			evidence.death = String(error).includes("server-exit");
		}
		return { ...evidence, seconds: (performance.now() - started) / 1000 };
	} finally {
		client.stop();
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = fileURLToPath(new URL("../..", import.meta.url));
	const output = resolve(process.argv[2] ?? `${root}/.bench/v3/protocol.json`);
	const servers = {
		apple: { command: "node", args: [`${root}/packages/mcp/dist/server.js`] },
		cua: { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] },
	};
	const runs = Number(process.argv[3] ?? 1);
	if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a positive integer");
	const report = { at: new Date().toISOString(), seed: 20261009, scope: "transport-only", results: [] };
	let seed = report.seed;
	mkdirSync(dirname(output), { recursive: true });
	for (let iteration = 1; iteration <= runs; iteration++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const routes = Object.entries(servers);
		if (seed & 0x80000000) routes.reverse();
		for (const [driver, spec] of routes) {
			let result;
			try {
				result = await probeProtocol(spec);
			} catch (error) {
				result = { error: String(error) };
			}
			report.results.push({ iteration, driver, ...result });
			writeFileSync(output, JSON.stringify(report, null, 2));
			process.stdout.write(`${driver} transport ${iteration}/${runs}: ${result.error ?? "recorded"}\n`);
		}
	}
	report.finished_at = new Date().toISOString();
	writeFileSync(output, JSON.stringify(report, null, 2));
	process.stdout.write(`Evidence: ${output}\n`);
}
