#!/usr/bin/env node
// Connectivity evidence: initialize each candidate MCP server and record its tool list. No tool is called.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient } from "../bench-v2/client.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const codexApp = path.join(os.homedir(), ".codex/computer-use/Codex Computer Use.app");
export const SERVERS = {
	"apple-cua": { command: "node", args: [path.join(root, "packages/mcp/dist/server.js")] },
	"cua-driver": { command: path.join(os.homedir(), ".local/bin/cua-driver"), args: ["mcp"] },
	"codex-computer-use": {
		command: path.join(
			codexApp,
			"Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
		),
		args: ["mcp"],
	},
};

const out = process.argv[2] ?? path.join(root, ".bench/v3/mcp-probe.json");
const report = { at: new Date().toISOString(), servers: {} };
for (const [name, spec] of Object.entries(SERVERS)) {
	const client = new McpClient({ ...spec, timeoutMs: 20000 });
	const started = performance.now();
	try {
		await client.start();
		const listed = await client.request("tools/list", {});
		report.servers[name] = {
			ok: true,
			init_ms: Math.round(performance.now() - started),
			tools: (listed.tools ?? []).map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 300) })),
		};
	} catch (error) {
		report.servers[name] = { ok: false, error: String(error).slice(0, 800), stderr: client.stderr.slice(-800) };
	} finally {
		client.stop();
	}
	process.stdout.write(
		`${name}: ${report.servers[name].ok ? `${report.servers[name].tools.length} tools` : report.servers[name].error}\n`,
	);
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
process.stdout.write(`Evidence: ${out}\n`);
process.exit(0);
