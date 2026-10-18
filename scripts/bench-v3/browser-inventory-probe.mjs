import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAgentRoute } from "./agents.mjs";

// Read-only availability evidence; never substitutes for a scored attempt.
const output = resolve(process.argv[2] ?? ".bench/v3/codex-browser-inventory.json");
const result = await runAgentRoute({
	route: "codex-native",
	task: `Perform a read-only browser inventory using Codex Computer Use.
Do not open, activate, navigate, close, or change any app, window, tab or permission.
Read the available browser tabs and report their browser identity, tab id and title.
Identify only tabs whose titles contain "cua-bench" or "bench-v3"; do not inspect
personal tab content. If the tool lacks session/turn metadata or is unavailable,
report the exact error. Do not supply fabricated metadata or use another route.
This is an inventory, not authorization to clean up.`,
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ kind: "read-only-availability-probe", result }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, exitCode: result.exitCode, answer: result.answer })}\n`);
