import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installHistoryService, uninstallHistoryService } from "./history-service.js";

let home = "";
beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "opencua-service-rename-")));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("#given a legacy history LaunchAgent #when installing or uninstalling #then it is unloaded and its plist removed", () => {
	it.each(["install", "uninstall"] as const)(
		"%s removes the legacy agent without touching history data",
		async (operation) => {
			const legacy = join(home, "Library/LaunchAgents/com.apple_cua.cua_history.plist");
			mkdirSync(dirname(legacy), { recursive: true });
			writeFileSync(legacy, "legacy agent");
			const stateDirectory = join(home, "state");
			mkdirSync(stateDirectory);
			writeFileSync(join(stateDirectory, "history.json"), "keep");
			const effects: string[][] = [];
			await (operation === "install" ? installHistoryService : uninstallHistoryService)({
				homeDirectory: home,
				stateDirectory,
				binary: "/fixture/history-recorder",
				platform: "darwin",
				uid: 501,
				launchctl: async (args) => {
					effects.push([...args]);
					return {
						code: args[0] === "print" && args[1]?.endsWith("/com.opencua.cua_history") ? 113 : 0,
						stderr: "",
					};
				},
			});
			expect(effects).toContainEqual(["bootout", "gui/501/com.apple_cua.cua_history"]);
			expect(existsSync(legacy)).toBe(false);
			expect(existsSync(join(stateDirectory, "history.json"))).toBe(true);
		},
	);
});
