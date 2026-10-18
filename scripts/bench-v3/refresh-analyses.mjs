import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readFileSync, rmSync } from "node:fs";
import { fixtureSmokeGate } from "./matrix-gate.mjs";

const gate = fixtureSmokeGate(JSON.parse(readFileSync(".bench/v3/text-faults-smoke.json", "utf8")), "text-faults");
if (!gate.ready) throw new Error(`fault cleanup gate failed: ${JSON.stringify(gate.failures)}`);
const fixtureRoot = lstatSync("/tmp/cua-bench");
if (!fixtureRoot.isDirectory() || fixtureRoot.isSymbolicLink()) throw new Error("invalid fixture root");
const lockPath = "/tmp/cua-bench/.run.lock";
const lock = openSync(lockPath, "wx");
try {
	for (const name of ["text-native", "menus", "attached", "browser-agent"]) {
		execFileSync(
			process.execPath,
			[
				"scripts/bench-v3/save-analysis.mjs",
				`.bench/v3/${name}-iteration-analysis.json`,
				`.bench/v3/${name}-30.json`,
			],
			{ stdio: "inherit", timeout: 1800000 },
		);
	}
	process.stdout.write("ITERATION_ANALYSES_REFRESHED\n");
} finally {
	closeSync(lock);
	rmSync(lockPath);
}
