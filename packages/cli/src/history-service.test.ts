import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HISTORY_SERVICE_LABEL,
	type HistoryServiceOptions,
	historyServiceStatus,
	installHistoryService,
	renderHistoryLaunchAgent,
	uninstallHistoryService,
} from "./history-service.js";

const dirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function baseOptions(calls: string[][]): HistoryServiceOptions {
	return {
		homeDirectory: tempDir("cua-history-home-"),
		stateDirectory: tempDir("cua-history-state-"),
		binary: "/opt/opencua/history-recorder",
		platform: "darwin",
		uid: 501,
		launchctl: async (args) => {
			calls.push([...args]);
			return { code: args[0] === "print" ? 113 : 0, stderr: "" };
		},
	};
}

describe("#given the watcher paths #when rendering the LaunchAgent #then it runs the binary at load and keeps it alive", () => {
	it("configures RunAtLoad, KeepAlive, the binary, and the state-dir env", () => {
		const plist = renderHistoryLaunchAgent({
			launchAgent: "/home/Library/LaunchAgents/x.plist",
			stateDirectory: "/home/.opencua",
			binary: "/opt/opencua/history-recorder",
			logDirectory: "/home/Library/Logs/cua-history",
			stdoutLog: "/home/Library/Logs/cua-history/stdout.log",
			stderrLog: "/home/Library/Logs/cua-history/stderr.log",
		});
		expect(plist).toContain(`<string>${HISTORY_SERVICE_LABEL}</string>`);
		expect(plist).toContain("<string>/opt/opencua/history-recorder</string>");
		expect(plist).toContain("<key>RunAtLoad</key>");
		expect(plist).toContain("<key>KeepAlive</key>");
		expect(plist).toContain("<string>/home/.opencua</string>");
	});
});

describe("#given a clean machine #when installing the service #then it writes the plist and bootstraps it", () => {
	it("writes a LaunchAgent and bootstraps the gui domain", async () => {
		const calls: string[][] = [];
		const options = baseOptions(calls);
		const paths = await installHistoryService(options);

		expect(readFileSync(paths.launchAgent, "utf8")).toContain(HISTORY_SERVICE_LABEL);
		expect(calls.some((call) => call[0] === "bootstrap" && call[1] === "gui/501")).toBe(true);
	});
});

describe("#given an installed service #when checking status then uninstalling #then it reports and boots out", () => {
	it("reports installed and removes the plist on uninstall", async () => {
		const calls: string[][] = [];
		const options = baseOptions(calls);
		const paths = await installHistoryService(options);

		const status = await historyServiceStatus(options);
		expect(status.installed).toBe(true);
		expect(status.state).toBe("stopped");

		await uninstallHistoryService(options);
		expect(() => readFileSync(paths.launchAgent, "utf8")).toThrow();
	});
});

describe("#given a non-macOS platform #when installing #then it refuses", () => {
	it("throws on linux", async () => {
		await expect(installHistoryService({ ...baseOptions([]), platform: "linux" })).rejects.toThrow(/only on macOS/);
	});
});
