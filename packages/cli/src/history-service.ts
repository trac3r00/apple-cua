import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { historyPaths, readHistoryState, resolveHistoryRecorderBinary, writeHistoryState } from "@apple-cua/core";
import { resolveStateDir } from "@apple-cua/core/stop";
import { resolveLayout } from "./layout.js";

const execFileAsync = promisify(execFile);

export const HISTORY_SERVICE_LABEL = "com.apple_cua.cua_history";

/** The LaunchAgent `apple-cua history start` installs; its presence means the watcher is set up. */
export function historyLaunchAgentPath(homeDirectory: string): string {
	return join(homeDirectory, "Library", "LaunchAgents", `${HISTORY_SERVICE_LABEL}.plist`);
}

export type HistoryServicePaths = {
	readonly launchAgent: string;
	readonly stateDirectory: string;
	readonly binary: string;
	readonly logDirectory: string;
	readonly stdoutLog: string;
	readonly stderrLog: string;
	readonly launcher?: string;
};

type LaunchctlResult = { readonly code: number; readonly stderr: string };

export type HistoryServiceOptions = {
	readonly homeDirectory?: string;
	readonly stateDirectory?: string;
	readonly binary?: string;
	readonly platform?: NodeJS.Platform;
	readonly uid?: number;
	readonly launchctl?: (arguments_: readonly string[]) => Promise<LaunchctlResult>;
};

export type HistoryServiceStatus = {
	readonly installed: boolean;
	readonly running: boolean;
	readonly state: "running" | "paused" | "stopped";
	readonly launchAgent: string;
	readonly eventStreamRootPath: string;
};

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderHistoryLaunchAgent(paths: HistoryServicePaths): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		"\t<key>Label</key>",
		`\t<string>${HISTORY_SERVICE_LABEL}</string>`,
		"\t<key>ProgramArguments</key>",
		"\t<array>",
		`\t\t<string>${escapeXml(paths.binary)}</string>`,
		"\t</array>",
		"\t<key>RunAtLoad</key>",
		"\t<true/>",
		"\t<key>KeepAlive</key>",
		"\t<dict>",
		"\t\t<key>SuccessfulExit</key>",
		"\t\t<false/>",
		"\t</dict>",
		"\t<key>EnvironmentVariables</key>",
		"\t<dict>",
		"\t\t<key>APPLE_CUA_STATE_DIR</key>",
		`\t\t<string>${escapeXml(paths.stateDirectory)}</string>`,
		"\t\t<key>APPLE_CUA_HISTORY_LAUNCHER</key>",
		`\t\t<string>${escapeXml(paths.launcher ?? resolveLayout().launcherPath)}</string>`,
		"\t</dict>",
		"\t<key>StandardOutPath</key>",
		`\t<string>${escapeXml(paths.stdoutLog)}</string>`,
		"\t<key>StandardErrorPath</key>",
		`\t<string>${escapeXml(paths.stderrLog)}</string>`,
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

async function runLaunchctl(arguments_: readonly string[]): Promise<LaunchctlResult> {
	try {
		const result = await execFileAsync("/bin/launchctl", [...arguments_], { encoding: "utf8" });
		return { code: 0, stderr: result.stderr };
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && typeof error.code === "number") {
			const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : error.message;
			return { code: error.code, stderr };
		}
		throw error;
	}
}

function serviceContext(options: HistoryServiceOptions) {
	const homeDirectory = options.homeDirectory ?? homedir();
	const stateDirectory = resolve(options.stateDirectory ?? resolveStateDir());
	const logDirectory = join(homeDirectory, "Library", "Logs", "cua-history");
	const bundleBinary = join(resolveLayout().helperApp, "Contents", "MacOS", "history-recorder");
	const binary = options.binary ?? (existsSync(bundleBinary) ? bundleBinary : resolveHistoryRecorderBinary());
	if (binary === undefined) {
		throw new Error(
			"The cua-history recorder binary is not built. Run scripts/build-tcc-helper.sh (or ./scripts/setup.sh) first.",
		);
	}
	const paths: HistoryServicePaths = {
		launchAgent: historyLaunchAgentPath(homeDirectory),
		stateDirectory,
		binary,
		logDirectory,
		stdoutLog: join(logDirectory, "stdout.log"),
		stderrLog: join(logDirectory, "stderr.log"),
		launcher: resolveLayout().launcherPath,
	};
	const uid = options.uid ?? userInfo().uid;
	const launchctl = options.launchctl ?? runLaunchctl;
	return { paths, domain: `gui/${uid}`, serviceTarget: `gui/${uid}/${HISTORY_SERVICE_LABEL}`, launchctl };
}

function ensureMac(options: HistoryServiceOptions): void {
	if ((options.platform ?? process.platform) !== "darwin") {
		throw new Error("The cua-history watcher is supported only on macOS.");
	}
}

export async function installHistoryService(options: HistoryServiceOptions = {}): Promise<HistoryServicePaths> {
	ensureMac(options);
	const context = serviceContext(options);
	await mkdir(context.paths.logDirectory, { recursive: true, mode: 0o700 });
	for (const log of [context.paths.stdoutLog, context.paths.stderrLog]) {
		await writeFile(log, "", { flag: "a", mode: 0o600 });
	}
	const previous = await context.launchctl(["print", context.serviceTarget]);
	if (previous.code === 0) {
		const unloaded = await context.launchctl(["bootout", context.serviceTarget]);
		if (unloaded.code !== 0) {
			throw new Error(`Could not restart the cua-history LaunchAgent: ${unloaded.stderr}`);
		}
	} else if (previous.code !== 113) {
		throw new Error(`Could not inspect the cua-history LaunchAgent: ${previous.stderr}`);
	}
	await mkdir(dirname(context.paths.launchAgent), { recursive: true, mode: 0o700 });
	await writeFile(context.paths.launchAgent, renderHistoryLaunchAgent(context.paths), { mode: 0o600 });
	await chmod(context.paths.launchAgent, 0o600);
	const bootstrapped = await context.launchctl(["bootstrap", context.domain, context.paths.launchAgent]);
	if (bootstrapped.code !== 0) {
		throw new Error(`Could not start the cua-history LaunchAgent: ${bootstrapped.stderr}`);
	}
	return context.paths;
}

export async function uninstallHistoryService(options: HistoryServiceOptions = {}): Promise<HistoryServicePaths> {
	ensureMac(options);
	const context = serviceContext(options);
	const status = await context.launchctl(["print", context.serviceTarget]);
	if (status.code === 0) {
		const unloaded = await context.launchctl(["bootout", context.serviceTarget]);
		if (unloaded.code !== 0) {
			throw new Error(`Could not stop the cua-history LaunchAgent: ${unloaded.stderr}`);
		}
	} else if (status.code !== 113) {
		throw new Error(`Could not inspect the cua-history LaunchAgent: ${status.stderr}`);
	}
	await rm(context.paths.launchAgent, { force: true });
	writeHistoryState(historyPaths(context.paths.stateDirectory), "stopped");
	return context.paths;
}

export async function historyServiceStatus(options: HistoryServiceOptions = {}): Promise<HistoryServiceStatus> {
	ensureMac(options);
	const context = serviceContext(options);
	const installed = await readFile(context.paths.launchAgent, "utf8").then(
		() => true,
		(error: unknown) => {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return false;
			}
			throw error;
		},
	);
	const printed = await context.launchctl(["print", context.serviceTarget]);
	return {
		installed,
		running: printed.code === 0,
		state: readHistoryState(historyPaths(context.paths.stateDirectory)),
		launchAgent: context.paths.launchAgent,
		eventStreamRootPath: historyPaths(context.paths.stateDirectory).root,
	};
}
