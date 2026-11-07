import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HistoryServiceOptions, installHistoryService, uninstallHistoryService } from "./history-service.js";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

/** launchd as observed: bootout returns while the job still unloads for `lingeringChecks` more print calls. */
function slowLaunchd(lingeringChecks: number) {
	let loaded = true;
	let lingering = 0;
	const calls: string[] = [];
	const pauses: number[] = [];
	const options: HistoryServiceOptions = {
		homeDirectory: tempDir("cua-history-home-"),
		stateDirectory: tempDir("cua-history-state-"),
		binary: "/opt/opencua/history-recorder",
		platform: "darwin",
		uid: 501,
		pause: async (milliseconds) => {
			pauses.push(milliseconds);
		},
		launchctl: async (args) => {
			calls.push(args[0] ?? "");
			if (args[0] === "print") {
				if (loaded) return { code: 0, stderr: "" };
				if (lingering > 0) {
					lingering--;
					return { code: 0, stderr: "" };
				}
				return { code: 113, stderr: "" };
			}
			if (args[0] === "bootout") {
				loaded = false;
				lingering = lingeringChecks;
				return { code: 0, stderr: "" };
			}
			if (args[0] === "bootstrap") {
				if (lingering > 0) return { code: 5, stderr: "Bootstrap failed: 5: Input/output error" };
				loaded = true;
				return { code: 0, stderr: "" };
			}
			return { code: 0, stderr: "" };
		},
	};
	return { options, calls, pauses };
}

describe("#given a running watcher #when history start restarts it #then it waits for launchd to unload first", () => {
	it("bootstraps only after the old job is gone instead of failing with Input/output error", async () => {
		const { options, calls, pauses } = slowLaunchd(3);

		await installHistoryService(options);

		expect(calls.filter((call) => call === "bootstrap")).toHaveLength(1);
		expect(pauses).toEqual([100, 100, 100]);
	});

	it("gives up with a clear error when the old job never unloads", async () => {
		const { options } = slowLaunchd(1_000);

		await expect(installHistoryService(options)).rejects.toThrow(/did not unload within 5 seconds/);
	});
});

describe("#given a running watcher #when history stop runs #then it returns only after the job is gone", () => {
	it("waits for the unload so an immediate start succeeds", async () => {
		const { options, calls } = slowLaunchd(2);

		await uninstallHistoryService(options);
		await installHistoryService(options);

		expect(calls.filter((call) => call === "bootstrap")).toHaveLength(1);
	});
});
