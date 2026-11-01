import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveLayout } from "./layout.js";
import { portableDoctor, runPlatformSetup } from "./platform-onboarding.js";
import type { CliRunner } from "./plugin-clients.js";

let home = "";
beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "opencua-platform-onboarding-")));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("#given a non-macOS installation #when doctor runs #then only platform-appropriate checks execute", () => {
	it.each(["linux", "win32"] as const)("checks %s without calling macOS tools", (platform) => {
		const layout = resolveLayout({ HOME: home }, home, platform);
		mkdirSync(dirname(layout.server), { recursive: true });
		writeFileSync(layout.server, "");
		const commands: string[] = [];
		const run: CliRunner = (command) => {
			commands.push(command);
			return { status: 0, stdout: "", stderr: "" };
		};
		const report = portableDoctor(layout, platform, { DISPLAY: ":1" }, run);
		expect(report.ready).toBe(true);
		expect(report.checks.map((check) => check.id)).toEqual(
			platform === "linux"
				? ["node", "server", "at-spi", "input", "screenshot", "desktop-session"]
				: ["node", "server", "uia"],
		);
		expect(commands).toEqual(platform === "linux" ? ["sh", "sh", "sh"] : ["powershell.exe"]);
	});

	it("fails missing Linux dependencies and supplies package-manager install instructions", () => {
		const report = portableDoctor(resolveLayout({ HOME: home }, home, "linux"), "linux", {}, () => ({
			status: 1,
			stdout: "",
			stderr: "missing",
		}));
		expect(report.ready).toBe(false);
		expect(report.checks.filter((check) => check.status === "fail").map((check) => check.id)).toEqual([
			"server",
			"at-spi",
			"input",
			"screenshot",
			"desktop-session",
		]);
		expect(report.nextSteps.join("\n")).toMatch(/apt-get install.*at-spi2-core/);
		expect(report.nextSteps.join("\n")).toContain("sudo dnf install");
		expect(report.nextSteps.join("\n")).toContain("sudo pacman -S");
	});
});

describe("#given setup on a supported platform #when dispatched #then the correct native shell receives its script", () => {
	it.each(["darwin", "linux", "win32"] as const)("dispatches %s setup and propagates its exit code", (platform) => {
		const layout = resolveLayout({ HOME: home }, home, platform);
		const calls: { command: string; args: readonly string[] }[] = [];
		const status = runPlatformSetup(layout, platform, (command, args) => {
			calls.push({ command, args });
			return 7;
		});
		expect(status).toBe(7);
		const windows = {
			command: "powershell.exe",
			args: ["-NoProfile", "-File", join(home, "scripts/install.ps1"), "-Checkout", home],
		};
		const unix = { command: "bash", args: [join(home, "scripts/setup.sh"), "--yes"] };
		expect(calls).toEqual([platform === "win32" ? windows : unix]);
	});
});
