import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient } from "../bench-v2/client.mjs";
import { startDisturbance } from "./disturbance.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "cua-pointer-readonly-"));
const binary = join(temporary, "trace");
const report = {
	scope: "read-only initialization and list_apps; no app launch, window input or pointer action",
	hypotheses: [
		"Cua launch or mutation input moves the pointer",
		"Read-only baseline observation or initialization moves the pointer",
		"Cursor measurement or another process moves the pointer independently",
	],
	results: [],
};
try {
	execFileSync("swiftc", [`${root}/scripts/bench-v3/disturbance.swift`, "-o", binary], { timeout: 60000 });
	for (const route of ["apple", "cua"]) {
		const client = new McpClient(
			route === "apple"
				? { command: "node", args: [`${root}/packages/mcp/dist/server.js`] }
				: { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] },
		);
		const trace = await startDisturbance(binary);
		const row = { route, calls: [] };
		try {
			let started = Date.now();
			await client.start();
			row.calls.push({ name: "initialize", start_epoch_ms: started, end_epoch_ms: Date.now() });
			started = Date.now();
			const result = await client.callTool("list_apps", {});
			row.calls.push({ name: "list_apps", start_epoch_ms: started, end_epoch_ms: Date.now(), result });
		} catch (error) {
			row.error = String(error);
		} finally {
			client.stop();
			row.trace = await trace.stop();
			report.results.push(row);
		}
	}
} finally {
	rmSync(temporary, { recursive: true });
}
const output = ".bench/v3/pointer-readonly-probe.json";
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
	`${JSON.stringify({ output, routes: report.results.map(({ route, trace, error }) => ({ route, trace, error })) })}\n`,
);
