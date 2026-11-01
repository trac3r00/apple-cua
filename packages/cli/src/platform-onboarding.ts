import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { DoctorCheck, DoctorReport } from "./doctor.js";
import type { Layout } from "./layout.js";
import { type CliRunner, runCli } from "./plugin-clients.js";

export const LINUX_INSTALL_HINTS = [
	"apt: sudo apt-get install at-spi2-core libatspi2.0-0 xdotool gnome-screenshot",
	"dnf: sudo dnf install at-spi2-core xdotool gnome-screenshot",
	"pacman: sudo pacman -S at-spi2-core xdotool gnome-screenshot",
	"Wayland: replace xdotool with ydotool and gnome-screenshot with grim; configure the ydotool daemon.",
].join("\n");

/** Non-macOS checks never probe a TCC helper, Mach-O binary or Apple service. */
export function portableDoctor(
	layout: Layout,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv = process.env,
	run: CliRunner = runCli,
): DoctorReport {
	const checks: DoctorCheck[] = [
		{
			id: "node",
			status: Number(process.versions.node.split(".")[0]) >= 20 ? "ok" : "fail",
			summary: `Node.js ${process.version}`,
			fix: "Install Node.js 20 or later.",
		},
		{
			id: "server",
			status: existsSync(layout.server) ? "ok" : "fail",
			summary: `MCP server: ${layout.server}`,
			fix: "Run opencua setup to build the TypeScript packages.",
		},
	];
	if (platform === "linux") {
		const probe = (script: string) => run("sh", ["-c", script], env).status === 0;
		for (const [id, summary, script] of [
			[
				"at-spi",
				"AT-SPI accessibility runtime",
				"pkg-config --exists atspi-2 2>/dev/null || ldconfig -p 2>/dev/null | grep libatspi >/dev/null || command -v at-spi-bus-launcher >/dev/null || test -x /usr/libexec/at-spi-bus-launcher || test -x /usr/lib/at-spi2-core/at-spi-bus-launcher",
			],
			["input", "xdotool or ydotool", "command -v xdotool >/dev/null || command -v ydotool >/dev/null"],
			[
				"screenshot",
				"screenshot tool",
				"command -v grim >/dev/null || command -v scrot >/dev/null || command -v gnome-screenshot >/dev/null || command -v import >/dev/null",
			],
		]) {
			if (id === undefined || summary === undefined || script === undefined) continue;
			checks.push({ id, summary, status: probe(script) ? "ok" : "fail", fix: LINUX_INSTALL_HINTS });
		}
		checks.push({
			id: "desktop-session",
			status: env["DISPLAY"] || env["WAYLAND_DISPLAY"] ? "ok" : "fail",
			summary: "Linux desktop session",
			fix: "Run in a graphical session with accessibility enabled (DISPLAY or WAYLAND_DISPLAY).",
		});
	} else if (platform === "win32") {
		const result = run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes",
			],
			env,
		);
		checks.push({
			id: "uia",
			status: result.status === 0 ? "ok" : "fail",
			summary: "Windows UI Automation",
			fix: "Run Windows PowerShell in an interactive desktop session with .NET UIAutomationClient available.",
		});
	} else {
		checks.push({ id: "platform", status: "fail", summary: `Unsupported platform: ${platform}` });
	}
	return {
		ready: checks.every((check) => check.status !== "fail"),
		onlyManualStepsRemain: false,
		checks,
		nextSteps: [...new Set(checks.flatMap((check) => (check.status !== "ok" && check.fix ? [check.fix] : [])))],
	};
}

/** Dispatch setup to the native shell rather than assuming /bin/bash exists on Windows. */
export function runPlatformSetup(
	layout: Layout,
	platform: NodeJS.Platform = process.platform,
	run: (command: string, args: readonly string[]) => number = (command, args) =>
		spawnSync(command, [...args], { stdio: "inherit" }).status ?? 1,
): number {
	switch (platform) {
		case "darwin":
		case "linux":
			return run("bash", [layout.setupScript, "--yes"]);
		case "win32":
			return run("powershell.exe", ["-NoProfile", "-File", layout.setupScript, "-Checkout", layout.checkout]);
		default:
			throw new Error(`Setup is not supported on ${platform}`);
	}
}
