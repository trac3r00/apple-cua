import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ClientContext, registerClient } from "./clients.js";
import { historyLaunchAgentPath, renderHistoryLaunchAgent, uninstallHistoryService } from "./history-service.js";
import { type Layout, resolveLayout } from "./layout.js";
import { DEFAULT_SETTINGS, desiredRegistration, saveSettings } from "./settings.js";
import {
	LAUNCHER_MARKER,
	PATH_LINE_MARKER,
	type PermissionReset,
	type UninstallFacts,
	executeUninstall,
	formatPlan,
	planUninstall,
	processesOfCheckout,
} from "./uninstall.js";

const BUNDLE_ID = "dev.applecua.mcp.test";

let root = "";
let home = "";
let layout: Layout;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "opencua-uninstall-")));
	home = join(root, "home");
	mkdirSync(join(root, "checkout"), { recursive: true });
	mkdirSync(home, { recursive: true });
	layout = resolveLayout({ HOME: home }, join(root, "checkout"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function facts(overrides: Partial<UninstallFacts> = {}): UninstallFacts {
	return {
		layout,
		marker: undefined,
		otherInstallerCheckout: undefined,
		trackedClients: [],
		clientEntries: [],
		processes: [],
		ownPids: [],
		helperPresent: true,
		helperBundleId: BUNDLE_ID,
		launchers: [],
		rcFiles: [],
		stateEntries: [],
		stateDirectories: [],
		stopPath: "/home/.opencua/stop.json",
		historyService: undefined,
		historyDirectories: [],
		...overrides,
	};
}

function entry(command: string) {
	return { command, args: [], env: {} };
}

describe("#given a developer checkout #when uninstall is planned #then the checkout is deleted only with --purge", () => {
	it("keeps the checkout by default, deletes it with --purge, and always removes what setup made", () => {
		const kept = planUninstall(facts(), { purge: false });
		const purged = planUninstall(facts(), { purge: true });

		expect(kept.removeCheckout).toBe(false);
		expect(kept.checkoutReason).toMatch(/developer checkout/);
		expect(formatPlan(kept)).toMatch(/leave:\n {2}checkout .* developer checkout/);
		expect(kept.removeHelper).toBe(layout.helperApp);
		expect(kept.resetPermissions).toBe(BUNDLE_ID);
		expect(purged.removeCheckout).toBe(true);
	});

	it("deletes the checkout install.sh created", () => {
		const plan = planUninstall(
			facts({ marker: { checkout: layout.checkout, repo: "https://example.invalid/a.git", ref: "master" } }),
			{ purge: false },
		);

		expect(plan.removeCheckout).toBe(true);
		expect(plan.checkoutReason).toBe("install.sh created it");
	});
});

describe("#given registrations of several installations #when uninstall is planned #then only this one's are removed", () => {
	it("unregisters this checkout's entry and a dead one it tracked, and leaves another installation's with its permissions", () => {
		const plan = planUninstall(
			facts({
				trackedClients: ["omo", "claude"],
				clientEntries: [
					{ client: "omo", entry: entry(layout.helperExecutable), runsThisCheckout: true, alive: true },
					{
						client: "codex",
						entry: entry("/other/opencua-mcp.app/Contents/MacOS/opencua-mcp"),
						runsThisCheckout: false,
						alive: true,
						otherHelperBundleId: BUNDLE_ID,
					},
					{ client: "claude", entry: entry("/deleted/opencua-mcp"), runsThisCheckout: false, alive: false },
				],
			}),
			{ purge: false },
		);

		expect(plan.unregister).toEqual(["omo", "claude"]);
		expect(plan.leaveRegistrations.map((item) => item.client)).toEqual(["codex"]);
		expect(plan.resetPermissions).toBeUndefined();
		expect(plan.keepPermissions).toMatch(/uses the same bundle id/);
	});

	it("leaves a dead entry it never tracked, and resets nothing when no helper is left to name", () => {
		const plan = planUninstall(
			facts({
				helperPresent: false,
				helperBundleId: undefined,
				clientEntries: [
					{ client: "omo", entry: entry("/deleted/opencua-mcp"), runsThisCheckout: false, alive: false },
				],
				stateEntries: [layout.configPath],
			}),
			{ purge: false },
		);

		expect(plan.unregister).toEqual([]);
		expect(plan.leaveRegistrations[0]?.reason).toMatch(/which is gone/);
		expect(plan.resetPermissions).toBeUndefined();
		expect(plan.keepPermissions).toMatch(/remove it there/);
	});

	it("unregisters every tracked plugin, extension and agent client through its adapter, but no untracked one", () => {
		const plan = planUninstall(
			facts({ trackedClients: ["omo", "claude", "codex", "gemini", "hermes", "openclaw", "pi", "json"] }),
			{ purge: false },
		);

		expect(plan.unregister).toEqual(["claude", "codex", "gemini", "hermes", "openclaw", "pi"]);
		expect(plan.pastedJson).toBe(true);
	});
});

describe("#given the shared stop switch #when uninstall is planned #then it stays while another installation does", () => {
	it("keeps the stop file and its folder for another installation's registration, and removes them when none is left", () => {
		const state = {
			stateEntries: [layout.configPath, "/home/.opencua/stop.json"],
			stateDirectories: [layout.openCuaHome, "/home/.opencua"],
		};
		const other = {
			client: "omo" as const,
			entry: entry("/other/opencua-mcp"),
			runsThisCheckout: false,
			alive: true,
		};

		const shared = planUninstall(facts({ ...state, clientEntries: [other] }), { purge: false });
		const alone = planUninstall(facts(state), { purge: false });

		expect(shared.removeState).toEqual([layout.configPath]);
		expect(shared.removeIfEmpty).toEqual([layout.openCuaHome]);
		expect(alone.removeState).toEqual(state.stateEntries);
		expect(alone.removeIfEmpty).toEqual(state.stateDirectories);
	});
});

describe("#given launchers and PATH lines #when uninstall is planned #then another installation keeps its own", () => {
	it("removes this checkout's launcher but keeps the PATH line while another installation's launcher uses the directory", () => {
		const rc = { path: join(home, ".zshrc"), text: `export PATH="$HOME/.local/bin:$PATH" ${PATH_LINE_MARKER}\n` };
		const ours = { path: layout.launcherPath, checkout: layout.checkout };
		const theirs = { path: join(layout.binDir, "other/../opencua"), checkout: "/other/checkout" };

		const alone = planUninstall(facts({ launchers: [ours], rcFiles: [rc] }), { purge: false });
		const shared = planUninstall(
			facts({ launchers: [ours, { ...theirs, path: join(layout.binDir, "opencua-other") }], rcFiles: [rc] }),
			{ purge: false },
		);
		const foreign = planUninstall(facts({ launchers: [{ path: "/opt/bin/opencua", checkout: undefined }] }), {
			purge: false,
		});

		expect(alone.removeLaunchers).toEqual([layout.launcherPath]);
		expect(alone.removePathLines).toEqual([{ path: rc.path, lines: [rc.text.trimEnd()] }]);
		expect(shared.removePathLines).toEqual([]);
		expect(foreign.removeLaunchers).toEqual([]);
		expect(foreign.leaveLaunchers).toEqual([{ path: "/opt/bin/opencua", reason: "not written by opencua setup" }]);
	});

	it("keeps OPENCUA_HOME while the installation install.sh made elsewhere still exists", () => {
		const plan = planUninstall(
			facts({
				otherInstallerCheckout: "/elsewhere/app",
				stateEntries: [layout.configPath],
				stateDirectories: [layout.openCuaHome],
			}),
			{ purge: false },
		);

		expect(plan.removeState).toEqual([]);
		expect(plan.removeIfEmpty).toEqual([]);
		expect(plan.keepState).toMatch(/still uses it/);
	});
});

describe("#given running processes #when this checkout's are selected #then only its helper, server and overlay match", () => {
	it("matches by path and never the uninstaller itself", () => {
		const overlay = join(layout.nativeDir, "cursor-overlay");
		const rows = [
			{ pid: 1, command: `${layout.helperExecutable} ${layout.server}` },
			{ pid: 2, command: `${layout.helperApp}/Contents/Resources/node ${layout.server}` },
			{ pid: 3, command: `${overlay} --socket /tmp/opencua-cursor.sock --idle 15` },
			{ pid: 4, command: "/other/checkout/packages/mcp/dist/server.js" },
			{ pid: 5, command: `node ${layout.server}` },
		];

		expect(processesOfCheckout(rows, layout, [5]).map((row) => row.pid)).toEqual([1, 2, 3]);
	});
});

describe("#given an installation in a temporary home #when uninstall runs #then what it made is gone and the rest is as it was", () => {
	function install(): { context: ClientContext; omo: string; omoBefore: string; zshrc: string; zshrcBefore: string } {
		mkdirSync(dirname(layout.helperExecutable), { recursive: true });
		writeFileSync(layout.helperExecutable, "");
		mkdirSync(dirname(layout.server), { recursive: true });
		writeFileSync(layout.server, "");
		const omo = join(home, ".omo/agent/mcp.json");
		const omoBefore = `${JSON.stringify({ mcpServers: { other: { command: "other" } } }, null, 2)}\n`;
		mkdirSync(dirname(omo), { recursive: true });
		writeFileSync(omo, omoBefore);
		const context = { home, env: { PATH: "" }, now: new Date(2026, 9, 6, 12, 0, 0) };
		const settings = { ...DEFAULT_SETTINGS, clients: ["omo"] as const };
		registerClient("omo", desiredRegistration(layout, settings), context);
		saveSettings(layout.configPath, settings);
		writeFileSync(join(layout.openCuaHome, "stop.json"), "{}");
		mkdirSync(layout.binDir, { recursive: true });
		writeFileSync(layout.launcherPath, `#!/bin/bash\n${LAUNCHER_MARKER}${layout.checkout}\nexec node cli.js "$@"\n`);
		const zshrc = join(home, ".zshrc");
		const zshrcBefore = "# mine\nexport FOO=1\n";
		writeFileSync(zshrc, `${zshrcBefore}export PATH="$HOME/.local/bin:$PATH" ${PATH_LINE_MARKER}\n`);
		return { context, omo, omoBefore, zshrc, zshrcBefore };
	}

	it.each([true, false])("shuts down owned history before teardown (success=%s)", async (succeeds) => {
		const { context } = install();
		const launchAgent = historyLaunchAgentPath(home);
		const binary = join(layout.helperApp, "Contents/MacOS/history-recorder");
		mkdirSync(dirname(launchAgent), { recursive: true });
		writeFileSync(
			launchAgent,
			renderHistoryLaunchAgent({
				launchAgent,
				binary,
				stateDirectory: layout.openCuaHome,
				logDirectory: root,
				stdoutLog: join(root, "stdout.log"),
				stderrLog: join(root, "stderr.log"),
			}),
		);
		const historyDirectory = join(layout.openCuaHome, "cua-history");
		mkdirSync(historyDirectory);
		writeFileSync(join(historyDirectory, "retained.jsonl"), "recorded activity\n");
		const plan = planUninstall(
			facts({
				historyService: { launchAgent, binary, stateDirectory: layout.openCuaHome },
				historyDirectories: [historyDirectory],
				processes: [{ pid: 4242, command: binary }],
			}),
			{ purge: false },
		);
		let loaded = true;
		const outcome = await executeUninstall(plan, {
			context,
			stopHistory: async (options) => {
				await uninstallHistoryService({
					...options,
					uid: 501,
					launchctl: async (args) => {
						if (args[0] === "print") return { code: loaded ? 0 : 113, stderr: "" };
						if (!succeeds) return { code: 1, stderr: "shutdown refused" };
						loaded = false;
						return { code: 0, stderr: "" };
					},
				});
			},
			signal: () => {
				if (!loaded) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
				throw new Error("History must be unloaded before process teardown.");
			},
			isAlive: () => loaded,
			wait: async () => {},
			launchServices: () => {},
			resetPermission: () => ({ status: "reset", output: "" }),
			print: () => {},
		});

		expect(loaded).toBe(!succeeds);
		expect(existsSync(launchAgent)).toBe(!succeeds);
		expect(existsSync(layout.helperApp)).toBe(!succeeds);
		expect(outcome.failures).toHaveLength(succeeds ? 0 : 1);
		expect(readFileSync(join(historyDirectory, "retained.jsonl"), "utf8")).toBe("recorded activity\n");
		expect(plan.keepHistory).toEqual([historyDirectory]);
	});

	it.each(["ESRCH", "EPERM"])("handles a process-exit race without hiding %s", async (code) => {
		const { context } = install();
		const plan = planUninstall(
			facts({ processes: [{ pid: 4242, command: `${layout.helperExecutable} ${layout.server}` }] }),
			{ purge: false },
		);
		let alive = true;
		const outcome = await executeUninstall(plan, {
			context,
			stopHistory: async () => {},
			signal: () => {
				alive = false;
				throw Object.assign(new Error(`kill ${code}`), { code });
			},
			isAlive: () => alive,
			wait: async () => {},
			launchServices: () => {},
			resetPermission: () => ({ status: "reset", output: "" }),
			print: () => {},
		});
		expect(outcome.failures).toEqual(code === "ESRCH" ? [] : ["stop pid 4242: kill EPERM"]);
	});

	it("preserves another checkout's history registration and shared grants", () => {
		const launchAgent = historyLaunchAgentPath(home);
		const plan = planUninstall(
			facts({
				historyService: {
					launchAgent,
					binary: join(root, "other/packages/mcp/dist/opencua-mcp.app/Contents/MacOS/history-recorder"),
					stateDirectory: layout.openCuaHome,
				},
			}),
			{ purge: false },
		);
		expect(plan.removeHistoryService).toBeUndefined();
		expect(plan.keepHistoryService).toBe(launchAgent);
		expect(plan.resetPermissions).toBeUndefined();
	});

	it("unregisters, stops, resets the permissions around a LaunchServices registration, and removes the rest", async () => {
		const { context, omo, omoBefore, zshrc, zshrcBefore } = install();
		const plan = planUninstall(
			facts({
				trackedClients: ["omo"],
				clientEntries: [
					{ client: "omo", entry: entry(layout.helperExecutable), runsThisCheckout: true, alive: true },
				],
				processes: [
					{ pid: 4242, command: `${layout.helperExecutable} ${layout.server}` },
					{ pid: 7, command: "/bin/other" },
				],
				launchers: [{ path: layout.launcherPath, checkout: layout.checkout }],
				rcFiles: [{ path: zshrc, text: readFileSync(zshrc, "utf8") }],
				stateEntries: [layout.configPath, join(layout.openCuaHome, "stop.json")],
				stateDirectories: [layout.openCuaHome],
			}),
			{ purge: false },
		);
		const calls: string[] = [];
		const alive = new Set([4242]);

		const outcome = await executeUninstall(plan, {
			context,
			stopHistory: async () => {},
			signal: (pid, signal) => {
				calls.push(`${signal} ${pid}`);
				alive.delete(pid);
			},
			isAlive: (pid) => alive.has(pid),
			wait: async () => {},
			launchServices: (action, app) => {
				calls.push(`${action} ${app}`);
			},
			resetPermission: (service, bundleId): PermissionReset => {
				calls.push(`reset ${service} ${bundleId}`);
				return { status: "reset", output: "" };
			},
			print: () => {},
		});

		expect(outcome.failures).toEqual([]);
		expect(calls).toEqual([
			"SIGTERM 4242",
			`register ${layout.helperApp}`,
			`reset Accessibility ${BUNDLE_ID}`,
			`reset ScreenCapture ${BUNDLE_ID}`,
			`reset AppleEvents ${BUNDLE_ID}`,
			`unregister ${layout.helperApp}`,
		]);
		expect(readFileSync(omo, "utf8")).toBe(omoBefore);
		expect(readFileSync(zshrc, "utf8")).toBe(zshrcBefore);
		expect(outcome.backups).toHaveLength(2);
		expect(outcome.backups.every((backup) => existsSync(backup))).toBe(true);
		expect(existsSync(layout.helperApp)).toBe(false);
		expect(existsSync(layout.launcherPath)).toBe(false);
		expect(existsSync(layout.openCuaHome)).toBe(false);
		expect(existsSync(layout.checkout)).toBe(true);
	});

	it("reports a bundle id tccutil cannot find as skipped with the manual way out, not as a failure", async () => {
		install();
		const plan = planUninstall(facts(), { purge: false });
		const lines: string[] = [];

		const outcome = await executeUninstall(plan, {
			context: { home, env: { PATH: "" }, now: new Date() },
			stopHistory: async () => {},
			signal: () => {},
			isAlive: () => false,
			wait: async () => {},
			launchServices: () => {},
			resetPermission: () => ({ status: "unknown-app", output: "No such bundle identifier" }),
			print: (text) => {
				lines.push(text);
			},
		});

		expect(outcome.failures).toEqual([]);
		expect(lines.join("\n")).toMatch(/tccutil cannot find dev\.applecua\.mcp\.test .*remove it there/);
	});
});
