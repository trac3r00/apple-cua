import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLayout } from "./layout.js";

let home = "";
beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "opencua-layout-")));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("#given legacy installation data #when layout resolves #then explicit settings and existing data win", () => {
	it.each([
		{ current: false, legacy: false, expected: ".opencua" },
		{ current: false, legacy: true, expected: ".apple-cua" },
		{ current: true, legacy: true, expected: ".opencua" },
	])("uses $expected with current=$current legacy=$legacy", ({ current, legacy, expected }) => {
		if (current) mkdirSync(join(home, ".opencua"));
		if (legacy) mkdirSync(join(home, ".apple-cua"));
		const layout = resolveLayout({ HOME: home }, home);
		expect(layout.openCuaHome).toBe(join(home, expected));
		expect(layout.configPath).toBe(join(home, expected, "config.json"));
	});

	it("uses legacy env settings only when renamed settings are unset", () => {
		const legacy = { HOME: home, APPLE_CUA_HOME: join(home, "old"), APPLE_CUA_BIN_DIR: join(home, "old-bin") };
		expect(resolveLayout(legacy, home).openCuaHome).toBe(legacy.APPLE_CUA_HOME);
		expect(resolveLayout(legacy, home).binDir).toBe(legacy.APPLE_CUA_BIN_DIR);
		const layout = resolveLayout({ ...legacy, OPENCUA_HOME: join(home, "new") }, home);
		expect(layout.openCuaHome).toBe(join(home, "new"));
	});

	it.each(["linux", "win32"] as const)("launches the JS server directly on %s", (platform) => {
		const layout = resolveLayout({ HOME: home, LOCALAPPDATA: home }, home, platform);
		expect(layout.helperExecutable).toBe(process.execPath);
		expect(layout.launcherPath).toBe(
			platform === "win32" ? join(home, "opencua/bin/opencua.cmd") : join(home, ".local/bin/opencua"),
		);
	});
});
