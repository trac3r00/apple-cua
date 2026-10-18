import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveStateDir } from "@apple-cua/core/stop";
import { z } from "zod";
import type { Connection } from "./connection.js";
import { connectionToken, readConnection, writeConnection } from "./connection.js";

const execFileAsync = promisify(execFile);

export const SERVICE_LABEL = "com.browser_skill_omo.daemon";
export const NATIVE_HOST_NAME = "com.browser_skill_omo.bridge";
export const EXTENSION_ID = "mlnfdbnljbighojpekgblaphpojllkdf";
export const extensionIdSchema = z.string().regex(/^[a-p]{32}$/);
export const DEFAULT_PORT = 47953;

export type ServicePaths = {
	readonly launchAgent: string;
	readonly nativeHostManifest: string;
	readonly nativeHostProgram: string;
	readonly nativeHostLauncher: string;
	readonly stateDirectory: string;
	readonly cliProgram: string;
	readonly logDirectory: string;
	readonly stdoutLog: string;
	readonly stderrLog: string;
};

type LaunchctlResult = {
	readonly code: number;
	readonly stderr: string;
};

export type ServiceOptions = {
	readonly extensionId?: string;
	readonly homeDirectory?: string;
	readonly packageRoot?: string;
	readonly nodePath?: string;
	readonly platform?: NodeJS.Platform;
	readonly uid?: number;
	readonly stateDirectory?: string;
	readonly isPortListening?: (port: number) => Promise<boolean>;
	readonly launchctl?: (arguments_: readonly string[]) => Promise<LaunchctlResult>;
};

export type DoctorResult = {
	readonly installed: boolean;
	readonly running: boolean;
	readonly connectionReady: boolean;
	readonly launchAgent: string;
	readonly nativeHostManifest: string;
};

export async function initializeConnectionMetadata(stateDirectory?: string): Promise<Connection> {
	try {
		return await readConnection(stateDirectory);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const connection = { port: DEFAULT_PORT, token: await connectionToken(stateDirectory) };
	await writeConnection(connection, stateDirectory);
	return connection;
}

function pathsFor(homeDirectory: string, packageRoot: string, stateDirectory: string): ServicePaths {
	const libraryDirectory = join(homeDirectory, "Library");
	const logDirectory = join(libraryDirectory, "Logs", "Browser-Skill-OmO");
	const nativeHostDirectory = join(
		libraryDirectory,
		"Application Support",
		"BraveSoftware",
		"Brave-Browser",
		"NativeMessagingHosts",
	);
	return {
		launchAgent: join(libraryDirectory, "LaunchAgents", `${SERVICE_LABEL}.plist`),
		nativeHostManifest: join(nativeHostDirectory, `${NATIVE_HOST_NAME}.json`),
		nativeHostProgram: join(packageRoot, "dist", "native-host.js"),
		nativeHostLauncher: join(stateDirectory, "browser-native-host"),
		stateDirectory,
		cliProgram: join(packageRoot, "dist", "cli.js"),
		logDirectory,
		stdoutLog: join(logDirectory, "stdout.log"),
		stderrLog: join(logDirectory, "stderr.log"),
	};
}

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderLaunchAgent(paths: ServicePaths, nodePath: string, port = DEFAULT_PORT): string {
	const args = [nodePath, paths.cliProgram, "serve"];
	const argumentsXml = args.map((argument) => `\t\t<string>${escapeXml(argument)}</string>`).join("\n");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		"\t<key>Label</key>",
		`\t<string>${SERVICE_LABEL}</string>`,
		"\t<key>ProgramArguments</key>",
		"\t<array>",
		argumentsXml,
		"\t</array>",
		"\t<key>WorkingDirectory</key>",
		`\t<string>${escapeXml(dirname(paths.cliProgram))}</string>`,
		"\t<key>RunAtLoad</key>",
		"\t<true/>",
		"\t<key>EnvironmentVariables</key>",
		"\t<dict>",
		"\t\t<key>APPLE_CUA_STATE_DIR</key>",
		`\t\t<string>${escapeXml(paths.stateDirectory)}</string>`,
		"\t\t<key>APPLE_CUA_BROWSER_PORT</key>",
		`\t\t<string>${port}</string>`,
		"\t</dict>",
		"\t<key>KeepAlive</key>",
		"\t<true/>",
		"\t<key>StandardOutPath</key>",
		`\t<string>${escapeXml(paths.stdoutLog)}</string>`,
		"\t<key>StandardErrorPath</key>",
		`\t<string>${escapeXml(paths.stderrLog)}</string>`,
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

export function renderNativeHostManifest(paths: ServicePaths, extensionId = EXTENSION_ID): string {
	return `${JSON.stringify(
		{
			name: NATIVE_HOST_NAME,
			description: "Browser-Skill-OmO local connection metadata",
			path: paths.nativeHostLauncher,
			type: "stdio",
			allowed_origins: [`chrome-extension://${extensionId}/`],
		},
		null,
		2,
	)}\n`;
}

export function renderNativeHostLauncher(paths: ServicePaths, nodePath: string, extensionId = EXTENSION_ID): string {
	const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
	return [
		"#!/bin/sh",
		`export APPLE_CUA_STATE_DIR=${quote(paths.stateDirectory)}`,
		`export APPLE_CUA_BROWSER_EXTENSION_ID=${quote(extensionId)}`,
		`exec ${quote(nodePath)} ${quote(paths.nativeHostProgram)} "$@"`,
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

async function portIsListening(port: number): Promise<boolean> {
	return await new Promise<boolean>((resolveConnection, reject) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolveConnection(true);
		});
		socket.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ECONNREFUSED") {
				resolveConnection(false);
				return;
			}
			if (error.code === "ECONNRESET") {
				resolveConnection(true);
				return;
			}
			reject(error);
		});
	});
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, contents, { mode: 0o600 });
	await chmod(path, 0o600);
}

async function ensurePrivateLog(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, "", { flag: "a", mode: 0o600 });
	await chmod(path, 0o600);
}

function serviceContext(options: ServiceOptions) {
	const homeDirectory = options.homeDirectory ?? homedir();
	const packageRoot = resolve(options.packageRoot ?? dirname(dirname(fileURLToPath(import.meta.url))));
	const stateDirectory = resolve(options.stateDirectory ?? resolveStateDir());
	const paths = pathsFor(homeDirectory, packageRoot, stateDirectory);
	const nodePath = options.nodePath ?? process.execPath;
	const uid = options.uid ?? userInfo().uid;
	const launchctl = options.launchctl ?? runLaunchctl;
	const checkPort = options.isPortListening ?? portIsListening;
	const domain = `gui/${uid}`;
	const serviceTarget = `${domain}/${SERVICE_LABEL}`;
	return { paths, nodePath, domain, serviceTarget, launchctl, checkPort, stateDirectory };
}

export async function installBrowserService(options: ServiceOptions = {}): Promise<ServicePaths> {
	const context = serviceContext(options);
	if ((options.platform ?? process.platform) !== "darwin") {
		throw new Error("The persistent browser service is supported only on macOS.");
	}
	const extensionId = extensionIdSchema.parse(
		options.extensionId ?? process.env["APPLE_CUA_BROWSER_EXTENSION_ID"] ?? EXTENSION_ID,
	);

	await mkdir(context.paths.logDirectory, { recursive: true, mode: 0o700 });
	await chmod(context.paths.logDirectory, 0o700);
	for (const path of [context.paths.stdoutLog, context.paths.stderrLog]) {
		await ensurePrivateLog(path);
	}
	const connection = await initializeConnectionMetadata(context.stateDirectory);

	const previous = await context.launchctl(["print", context.serviceTarget]);
	if (previous.code === 0) {
		const unloaded = await context.launchctl(["bootout", context.serviceTarget]);
		if (unloaded.code !== 0) throw new Error(`Could not restart the browser LaunchAgent: ${unloaded.stderr}`);
	} else if (previous.code !== 113) {
		throw new Error(`Could not inspect the browser LaunchAgent: ${previous.stderr}`);
	}
	if (await context.checkPort(connection.port)) {
		throw new Error(
			`Port ${connection.port} is already in use. Stop the existing browser serve process before installing the daemon.`,
		);
	}
	const artifacts = [
		{
			path: context.paths.launchAgent,
			contents: renderLaunchAgent(context.paths, context.nodePath, connection.port),
			mode: 0o600,
		},
		{
			path: context.paths.nativeHostLauncher,
			contents: renderNativeHostLauncher(context.paths, context.nodePath, extensionId),
			mode: 0o700,
		},
		{
			path: context.paths.nativeHostManifest,
			contents: renderNativeHostManifest(context.paths, extensionId),
			mode: 0o600,
		},
	];
	const backups = await Promise.all(
		artifacts.map(async ({ path }) => {
			try {
				return { path, contents: await readFile(path), mode: (await stat(path)).mode & 0o777 };
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") {
					return { path, contents: undefined, mode: undefined };
				}
				throw error;
			}
		}),
	);
	const writtenPaths = new Set<string>();
	try {
		for (const artifact of artifacts) {
			writtenPaths.add(artifact.path);
			await writePrivateFile(artifact.path, artifact.contents);
			await chmod(artifact.path, artifact.mode);
		}
		const bootstrapped = await context.launchctl(["bootstrap", context.domain, context.paths.launchAgent]);
		if (bootstrapped.code !== 0) throw new Error(`Could not start the browser LaunchAgent: ${bootstrapped.stderr}`);
	} catch (error) {
		for (const backup of backups) {
			if (!writtenPaths.has(backup.path)) continue;
			if (backup.contents === undefined) {
				await rm(backup.path, { force: true });
			} else {
				await writeFile(backup.path, backup.contents);
				await chmod(backup.path, backup.mode);
			}
		}
		throw error;
	}
	return context.paths;
}

export async function doctorBrowserService(options: ServiceOptions = {}): Promise<DoctorResult> {
	const context = serviceContext(options);
	if ((options.platform ?? process.platform) !== "darwin") {
		throw new Error("The persistent browser service is supported only on macOS.");
	}
	const [launchAgent, nativeHostManifest, nativeHostLauncher, connectionReady] = await Promise.all([
		readFile(context.paths.launchAgent, "utf8").then(
			() => true,
			(error: unknown) => {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
				throw error;
			},
		),
		readFile(context.paths.nativeHostManifest, "utf8").then(
			() => true,
			(error: unknown) => {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
				throw error;
			},
		),
		readFile(context.paths.nativeHostLauncher).then(
			() => true,
			(error: unknown) => {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
				throw error;
			},
		),
		readConnection(context.stateDirectory).then(
			() => true,
			(error: unknown) => {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
				throw error;
			},
		),
	]);
	const status = await context.launchctl(["print", context.serviceTarget]);
	return {
		installed: launchAgent && nativeHostManifest && nativeHostLauncher,
		running: status.code === 0,
		connectionReady,
		launchAgent: context.paths.launchAgent,
		nativeHostManifest: context.paths.nativeHostManifest,
	};
}

export async function uninstallBrowserService(options: ServiceOptions = {}): Promise<ServicePaths> {
	const context = serviceContext(options);
	if ((options.platform ?? process.platform) !== "darwin") {
		throw new Error("The persistent browser service is supported only on macOS.");
	}
	const status = await context.launchctl(["print", context.serviceTarget]);
	if (status.code === 0) {
		const unloaded = await context.launchctl(["bootout", context.serviceTarget]);
		if (unloaded.code !== 0) throw new Error(`Could not stop the browser LaunchAgent: ${unloaded.stderr}`);
	} else if (status.code !== 113) {
		throw new Error(`Could not inspect the browser LaunchAgent: ${status.stderr}`);
	}
	await Promise.all([
		rm(context.paths.launchAgent, { force: true }),
		rm(context.paths.nativeHostManifest, { force: true }),
		rm(context.paths.nativeHostLauncher, { force: true }),
	]);
	return context.paths;
}
