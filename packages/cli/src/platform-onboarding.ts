import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { DoctorCheck, DoctorReport } from "./doctor.js";
import type { Layout } from "./layout.js";
import { type CliRunner, runCli } from "./plugin-clients.js";

export const LINUX_INSTALL_HINTS = [
	"apt: sudo apt-get install at-spi2-core python3-gi gir1.2-atspi-2.0 gir1.2-gdkpixbuf-2.0 imagemagick",
	"dnf: sudo dnf install at-spi2-core python3-gobject gdk-pixbuf2 ImageMagick",
	"pacman: sudo pacman -S at-spi2-core python-gobject gdk-pixbuf2 imagemagick",
	"Wayland: install grim instead of imagemagick; the xdg-desktop-portal screenshot is the fallback.",
	"Physical input (opt-in only): xdotool on X11, or ydotool with its daemon on Wayland.",
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
		const wayland = (env["WAYLAND_DISPLAY"] ?? "") !== "";
		// The helper reaches AT-SPI through Python GI, so probe that import rather than the C library.
		checks.push({
			id: "at-spi",
			summary: "Python GI with the AT-SPI and GdkPixbuf typelibs",
			status: probe(
				"python3 -c \"import gi; gi.require_version('Atspi', '2.0'); gi.require_version('GdkPixbuf', '2.0'); from gi.repository import Atspi, GdkPixbuf\" >/dev/null 2>&1",
			)
				? "ok"
				: "fail",
			fix: LINUX_INSTALL_HINTS,
		});
		// Capture uses grim (or the portal) on Wayland and ImageMagick `import` on X11; nothing else.
		checks.push({
			id: "screenshot",
			summary: wayland ? "grim or the desktop portal (Wayland)" : "ImageMagick import (X11)",
			status: wayland
				? probe("command -v grim >/dev/null")
					? "ok"
					: "warn"
				: probe("command -v import >/dev/null")
					? "ok"
					: "fail",
			fix: LINUX_INSTALL_HINTS,
		});
		// Physical input is opt-in, so its tool is a warning rather than a failed installation.
		checks.push({
			id: "input",
			summary: wayland ? "ydotool, for opt-in physical input (Wayland)" : "xdotool, for opt-in physical input (X11)",
			status: probe(`command -v ${wayland ? "ydotool" : "xdotool"} >/dev/null`) ? "ok" : "warn",
			fix: LINUX_INSTALL_HINTS,
		});
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
			// The installer is a local .ps1, which the default Restricted policy would refuse to run.
			return run("powershell.exe", [
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				layout.setupScript,
				"-Checkout",
				layout.checkout,
			]);
		default:
			throw new Error(`Setup is not supported on ${platform}`);
	}
}
