import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { interruptedBrowserFailureVerified } from "./matrix-gate.mjs";

export function archiveAgentLogs(rows, destination, agentRoot = join(tmpdir(), "cua-bench/v3/agents")) {
	const root = lstatSync(agentRoot, { throwIfNoEntry: false }) ? realpathSync(agentRoot) : resolve(agentRoot);
	const lexicalRoot = resolve(agentRoot);
	const output = resolve(destination);
	mkdirSync(output);
	return rows.map((row, index) => {
		const entry = { index, route: row.route, task: row.task ?? row.scenario, iteration: row.iteration };
		for (const key of ["stdoutPath", "stderrPath", "driverLog"]) {
			const source = row.agent?.[key];
			if (!source) {
				entry[key] = { missing: true, source: null };
				continue;
			}
			const path = resolve(source);
			if (!path.startsWith(`${root}${sep}`) && !path.startsWith(`${lexicalRoot}${sep}`))
				throw new Error("log outside agent root");
			const stat = lstatSync(path, { throwIfNoEntry: false });
			if (!stat) {
				entry[key] = { missing: true, source };
				continue;
			}
			if (!stat.isFile() || !realpathSync(path).startsWith(`${root}${sep}`))
				throw new Error("nonregular or redirected agent log refused");
			const bytes = readFileSync(path);
			const archived = join(output, `${index}-${key}.raw`);
			writeFileSync(archived, bytes, { flag: "wx" });
			entry[key] = {
				source,
				archived,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}
		return entry;
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [source, destination, mode] = process.argv.slice(2);
	if (mode && mode !== "--snapshot") throw new Error("unsupported archive mode");
	const snapshot = mode === "--snapshot";
	if (!source || !destination) throw new Error("usage: archive-agent-logs <terminal-raw.json> <new-directory>");
	const bytes = readFileSync(source);
	const report = JSON.parse(bytes.toString("utf8"));
	if (!Array.isArray(report.results) || (!snapshot && !report.summary && !report.finished_at))
		throw new Error("terminal result artifact required");
	if (
		!snapshot &&
		report.results.some(
			(row) => row.interrupted === true && !interruptedBrowserFailureVerified(row, report.cleanup_recoveries),
		)
	)
		throw new Error("unfinished agent slot");
	const manifest = {
		source: resolve(source),
		sha256: createHash("sha256").update(bytes).digest("hex"),
		snapshot,
		logs: archiveAgentLogs(report.results, destination),
	};
	writeFileSync(join(destination, "source.json"), bytes, { flag: "wx" });
	writeFileSync(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
	process.stdout.write(`AGENT_LOGS_ARCHIVED ${manifest.logs.length} slots\n`);
}
