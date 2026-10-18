import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runAgentRoute } from "./agents.mjs";

const output = resolve(process.argv[2] ?? ".bench/v3/agent-connectivity.json");
const routes = ["omo-apple", "omo-cua", "omo-native", "codex-apple", "codex-cua", "codex-native"];
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());
const report = { scope: "read-only agent tool execution; not task completion", results: [] };
mkdirSync(dirname(output), { recursive: true });
for (const route of routes) {
	if (controller.signal.aborted) break;
	const tool = route.endsWith("apple")
		? "list_apps"
		: route.endsWith("cua")
			? "list_apps"
			: route.startsWith("omo")
				? "computer.capabilities()"
				: "list_apps";
	try {
		const result = await runAgentRoute({
			route,
			task: `Call ${tool} once using the named computer-use hand and report the result. Do not perform any input, activation, navigation, clipboard operation, or other mutation.`,
			signal: controller.signal,
		});
		report.results.push({ route, ...result });
		process.stdout.write(`${route}: exit=${result.exitCode}, model=${result.model}, calls=${result.toolCalls}\n`);
	} catch (error) {
		report.results.push({ route, error: String(error) });
		process.stdout.write(`${route}: ${String(error)}\n`);
	}
	writeFileSync(output, JSON.stringify(report, null, 2));
}
