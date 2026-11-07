import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as realChildProcess from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "@opencua/test-support";
import { Command } from "commander";
vi.mock("node:child_process", () => ({
	...realChildProcess,
	spawnSync: vi.fn(() => ({ pid: 0, output: [], stdout: "", stderr: "", status: 0, signal: null })),
}));
const { spawnSync } = await import("node:child_process");
const { registerLifecycleCommands } = await import("./lifecycle-commands.js");

let home = "";
const previousExitCode = process.exitCode;
beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "opencua-onboarding-command-")));
	vi.stubEnv("HOME", home);
	vi.stubEnv("OPENCUA_HOME", join(home, ".opencua"));
	vi.stubEnv("DISPLAY", ":1");
	vi.mocked(spawnSync).mockClear();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	process.exitCode = previousExitCode;
	rmSync(home, { recursive: true, force: true });
});

describe("#given Linux or Windows #when CLI onboarding commands run #then no macOS tool is invoked", () => {
	it.each(["linux", "win32"] as const)("doctor and doctor --fix use %s checks", async (platform) => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		const program = new Command();
		registerLifecycleCommands(program, { isJsonOutput: () => true, platform });
		await program.parseAsync(["doctor"], { from: "user" });
		await program.parseAsync(["doctor", "--fix", "--no-wait"], { from: "user" });
		const commands = vi.mocked(spawnSync).mock.calls.map(([command]) => command);
		expect(commands).toEqual(
			platform === "linux" ? ["sh", "sh", "sh", "sh", "sh", "sh"] : ["powershell.exe", "powershell.exe"],
		);
	});

	it.each(["linux", "win32"] as const)("setup dispatches through the %s shell", async (platform) => {
		const program = new Command();
		registerLifecycleCommands(program, { isJsonOutput: () => false, platform });
		await program.parseAsync(["setup"], { from: "user" });
		const command = vi.mocked(spawnSync).mock.calls[0];
		expect(command?.[0]).toBe(platform === "win32" ? "powershell.exe" : "bash");
		expect(command?.[1]).toContainEqual(expect.stringMatching(platform === "win32" ? /install\.ps1$/ : /setup\.sh$/));
	});
});
