import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { StopSwitch } from "@apple-cua/core";
import {
	type ClientContext,
	type ClientName,
	type RegisteredEntry,
	describeChange,
	entryAlive,
	entryRunsCheckout,
	readClientEntry,
	unregisterClient,
	writeConfigFile,
} from "./clients.js";
import {
	type Environment,
	type InstallMarker,
	type Layout,
	canonicalPath,
	displayPath,
	readInstallMarker,
} from "./layout.js";
import { loadSettings } from "./settings.js";

/** Second line of every launcher scripts/setup.sh writes, followed by the checkout it runs. */
export const LAUNCHER_MARKER = "# apple-cua-launcher checkout=";
/** Ends the one line `setup.sh --add-to-path` appends to a shell startup file. */
export const PATH_LINE_MARKER = "# added by apple-cua";
const TCC_SERVICES = ["Accessibility", "ScreenCapture", "AppleEvents"] as const;
const HELPER_EXECUTABLE = "/Contents/MacOS/apple-cua-mcp";
const LSREGISTER =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export interface ProcessRow {
	readonly pid: number;
	readonly command: string;
}

export interface ClientEntryFacts {
	readonly client: ClientName;
	readonly entry: RegisteredEntry | undefined;
	/** The entry runs this checkout's helper or server.js. */
	readonly runsThisCheckout: boolean;
	/** What the entry runs still exists. */
	readonly alive: boolean;
	/** For an entry that runs another checkout's helper: that helper's bundle id. */
	readonly otherHelperBundleId?: string | undefined;
}

/** Everything uninstall decides from, read without changing anything. */
export interface UninstallFacts {
	readonly layout: Layout;
	readonly marker: InstallMarker | undefined;
	/** A checkout install.sh created elsewhere that still exists, and so still uses APPLE_CUA_HOME. */
	readonly otherInstallerCheckout: string | undefined;
	readonly trackedClients: readonly ClientName[];
	readonly clientEntries: readonly ClientEntryFacts[];
	readonly processes: readonly ProcessRow[];
	readonly ownPids: readonly number[];
	readonly helperPresent: boolean;
	/** CFBundleIdentifier of this checkout's helper app (or APPLE_CUA_BUNDLE_ID when the helper is gone). */
	readonly helperBundleId: string | undefined;
	readonly launchers: readonly { readonly path: string; readonly checkout: string | undefined }[];
	readonly rcFiles: readonly { readonly path: string; readonly text: string }[];
	/** Existing per-user state: config.json, install.json, the stop file, the downloaded Node.js. */
	readonly stateEntries: readonly string[];
	/** apple-cua's own directories, removed at the end when nothing else is left in them. */
	readonly stateDirectories: readonly string[];
	/** The stop switch file, which every installation on this Mac shares (~/.apple-cua/stop.json). */
	readonly stopPath: string;
}

export interface UninstallPlan {
	readonly layout: Layout;
	readonly unregister: readonly ClientName[];
	readonly leaveRegistrations: readonly { readonly client: ClientName; readonly reason: string }[];
	readonly pastedJson: boolean;
	readonly stopProcesses: readonly ProcessRow[];
	/** The bundle id whose Accessibility, Screen Recording and Automation entries are reset. */
	readonly resetPermissions: string | undefined;
	readonly keepPermissions: string | undefined;
	readonly removeHelper: string | undefined;
	readonly removeLaunchers: readonly string[];
	readonly leaveLaunchers: readonly { readonly path: string; readonly reason: string }[];
	readonly removePathLines: readonly { readonly path: string; readonly lines: readonly string[] }[];
	readonly removeState: readonly string[];
	readonly removeIfEmpty: readonly string[];
	readonly keepState: string | undefined;
	readonly removeCheckout: boolean;
	readonly checkoutReason: string;
}

/** Processes started from this checkout: its helper (launcher and bundled node), its server.js, its cursor overlay. */
export function processesOfCheckout(
	rows: readonly ProcessRow[],
	layout: Pick<Layout, "helperApp" | "server" | "nativeDir">,
	ownPids: readonly number[],
): ProcessRow[] {
	const overlay = join(layout.nativeDir, "cursor-overlay");
	return rows.filter(
		(row) =>
			!ownPids.includes(row.pid) &&
			(row.command.startsWith(`${layout.helperApp}/Contents/`) ||
				row.command.includes(layout.server) ||
				row.command === overlay ||
				row.command.startsWith(`${overlay} `)),
	);
}

/** What uninstall would do. Pure: a developer checkout is never deleted without --purge. */
export function planUninstall(facts: UninstallFacts, options: { readonly purge: boolean }): UninstallPlan {
	const { layout } = facts;
	const installerCheckout = facts.marker?.checkout === layout.checkout;

	const unregister: ClientName[] = [];
	const leaveRegistrations: { client: ClientName; reason: string }[] = [];
	let sharedWith: string | undefined;
	let anotherInstallationStays = facts.otherInstallerCheckout !== undefined;
	for (const item of facts.clientEntries) {
		if (item.entry === undefined) {
			continue;
		}
		const command = item.entry.command ?? "another command";
		if (item.runsThisCheckout || (!item.alive && facts.trackedClients.includes(item.client))) {
			unregister.push(item.client);
		} else if (!item.alive) {
			leaveRegistrations.push({
				client: item.client,
				reason: `it runs ${command}, which is gone, and this installation did not register it`,
			});
		} else {
			leaveRegistrations.push({ client: item.client, reason: `it runs ${command}, another installation` });
			anotherInstallationStays = true;
			if (facts.helperBundleId !== undefined && item.otherHelperBundleId === facts.helperBundleId) {
				sharedWith ??= command;
			}
		}
	}

	const installed = facts.helperPresent || facts.trackedClients.length > 0 || facts.stateEntries.length > 0;
	let keepPermissions: string | undefined;
	if (facts.helperBundleId === undefined) {
		keepPermissions = installed
			? 'no helper app is left to name, so no permission is reset; if "apple-cua-mcp" is still listed in System Settings > Privacy & Security, remove it there'
			: undefined;
	} else if (sharedWith !== undefined) {
		keepPermissions = `the permissions of ${facts.helperBundleId}: ${sharedWith} uses the same bundle id`;
	}

	const removeLaunchers = facts.launchers
		.filter((launcher) => launcher.checkout === layout.checkout)
		.map((launcher) => launcher.path);
	const leaveLaunchers = facts.launchers
		.filter((launcher) => launcher.checkout !== layout.checkout)
		.map((launcher) => ({
			path: launcher.path,
			reason:
				launcher.checkout === undefined
					? "not written by apple-cua setup"
					: `it runs ${launcher.checkout}, another installation`,
		}));
	const anotherLauncherStays = facts.launchers.some(
		(launcher) =>
			launcher.checkout !== undefined &&
			launcher.checkout !== layout.checkout &&
			dirname(launcher.path) === layout.binDir,
	);
	const removePathLines = anotherLauncherStays
		? []
		: facts.rcFiles.flatMap((rc) => {
				const lines = rc.text.split("\n").filter((line) => line.trimEnd().endsWith(PATH_LINE_MARKER));
				return lines.length === 0 ? [] : [{ path: rc.path, lines }];
			});

	if (facts.launchers.some((launcher) => launcher.checkout !== undefined && launcher.checkout !== layout.checkout)) {
		anotherInstallationStays = true;
	}
	// The stop switch belongs to every installation on this Mac: it stays while another one does.
	const shared = anotherInstallationStays ? [facts.stopPath, dirname(facts.stopPath)] : [];
	const keepState =
		facts.otherInstallerCheckout === undefined
			? undefined
			: `${displayPath(layout.appleCuaHome, layout.home)}: the installation in ${displayPath(facts.otherInstallerCheckout, layout.home)} still uses it (its apple-cua uninstall removes it)`;
	return {
		layout,
		unregister,
		leaveRegistrations,
		pastedJson: facts.trackedClients.includes("json"),
		stopProcesses: processesOfCheckout(facts.processes, layout, facts.ownPids),
		resetPermissions: keepPermissions === undefined ? facts.helperBundleId : undefined,
		keepPermissions,
		removeHelper: facts.helperPresent ? layout.helperApp : undefined,
		removeLaunchers,
		leaveLaunchers,
		removePathLines,
		removeState: keepState === undefined ? facts.stateEntries.filter((path) => !shared.includes(path)) : [],
		removeIfEmpty: keepState === undefined ? facts.stateDirectories.filter((path) => !shared.includes(path)) : [],
		keepState,
		removeCheckout: installerCheckout || options.purge,
		checkoutReason: installerCheckout
			? "install.sh created it"
			: options.purge
				? "--purge was given"
				: "a developer checkout; --purge deletes it too",
	};
}

export function formatPlan(plan: UninstallPlan): string {
	const show = (path: string) => displayPath(path, plan.layout.home);
	const lines = ["apple-cua uninstall will:"];
	const row = (verb: string, text: string) => {
		lines.push(`  ${verb.padEnd(11)}${text}`);
	};
	for (const client of plan.unregister) {
		row("unregister", `${client} (its config file is backed up first)`);
	}
	for (const item of plan.stopProcesses) {
		row("stop", `pid ${item.pid}: ${item.command}`);
	}
	if (plan.resetPermissions !== undefined) {
		row("reset", `the Accessibility, Screen Recording and Automation permissions of ${plan.resetPermissions}`);
	}
	if (plan.removeHelper !== undefined) {
		row("remove", `helper app ${show(plan.removeHelper)}`);
	}
	for (const launcher of plan.removeLaunchers) {
		row("remove", `launcher ${show(launcher)}`);
	}
	for (const rc of plan.removePathLines) {
		row("remove", `the PATH line in ${show(rc.path)} (backed up first)`);
	}
	for (const entry of plan.removeState) {
		row("remove", show(entry));
	}
	if (plan.removeCheckout) {
		row("remove", `checkout ${show(plan.layout.checkout)} (${plan.checkoutReason})`);
	}
	if (lines.length === 1) {
		lines.push("  nothing: no part of this installation is left");
	}
	const kept = [
		...(plan.removeCheckout ? [] : [`checkout ${show(plan.layout.checkout)}: ${plan.checkoutReason}`]),
		...plan.leaveRegistrations.map((item) => `${item.client} registration: ${item.reason}`),
		...plan.leaveLaunchers.map((launcher) => `${show(launcher.path)}: ${launcher.reason}`),
		...(plan.keepPermissions === undefined ? [] : [plan.keepPermissions]),
		...(plan.keepState === undefined ? [] : [plan.keepState]),
		...(plan.pastedJson ? ['any "apple-cua" block you pasted into another MCP client: remove it by hand'] : []),
	];
	if (kept.length > 0) {
		lines.push("and leave:");
		for (const item of kept) {
			lines.push(`  ${item}`);
		}
	}
	return lines.join("\n");
}

export interface PermissionReset {
	/** `unknown-app`: tccutil found no app with the bundle id (LaunchServices does not look in temporary folders). */
	readonly status: "reset" | "unknown-app" | "failed";
	readonly output: string;
}

export interface UninstallDependencies {
	readonly context: ClientContext;
	readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
	readonly isAlive: (pid: number) => boolean;
	readonly wait: (milliseconds: number) => Promise<void>;
	/** Makes an app known to LaunchServices, or forgets it: tccutil finds a bundle id only through LaunchServices. */
	readonly launchServices: (action: "register" | "unregister", app: string) => void;
	/** `tccutil reset <service> <bundle id>`. */
	readonly resetPermission: (service: string, bundleId: string) => PermissionReset;
	readonly print: (text: string) => void;
}

export interface UninstallOutcome {
	readonly backups: readonly string[];
	readonly failures: readonly string[];
}

/** Carries out a plan. Every step runs even when an earlier one fails; failures are collected and reported. */
export async function executeUninstall(plan: UninstallPlan, deps: UninstallDependencies): Promise<UninstallOutcome> {
	const { layout } = plan;
	const show = (path: string) => displayPath(path, layout.home);
	const backups: string[] = [];
	const failures: string[] = [];
	const done = (verb: string, text: string) => {
		deps.print(`  ${verb.padEnd(13)}${text}`);
	};
	const attempt = (what: string, action: () => void) => {
		try {
			action();
		} catch (error) {
			const message = `${what}: ${error instanceof Error ? error.message : String(error)}`;
			failures.push(message);
			done("FAILED", message);
		}
	};

	for (const client of plan.unregister) {
		attempt(`unregister ${client}`, () => {
			const change = unregisterClient(client, deps.context);
			if (change.backup !== undefined) {
				backups.push(change.backup);
			}
			done("unregistered", describeChange(change, show));
		});
	}

	if (plan.stopProcesses.length > 0) {
		for (const item of plan.stopProcesses) {
			attempt(`stop pid ${item.pid}`, () => deps.signal(item.pid, "SIGTERM"));
		}
		for (let waited = 0; waited < 3_000 && plan.stopProcesses.some((item) => deps.isAlive(item.pid)); waited += 100) {
			await deps.wait(100);
		}
		for (const item of plan.stopProcesses) {
			if (deps.isAlive(item.pid)) {
				attempt(`kill pid ${item.pid}`, () => deps.signal(item.pid, "SIGKILL"));
			}
			done("stopped", `pid ${item.pid}: ${item.command}`);
		}
	}

	if (plan.resetPermissions !== undefined) {
		const bundleId = plan.resetPermissions;
		if (plan.removeHelper !== undefined) {
			deps.launchServices("register", plan.removeHelper);
		}
		for (const service of TCC_SERVICES) {
			const result = deps.resetPermission(service, bundleId);
			if (result.status === "reset") {
				done("reset", `${service} permission of ${bundleId}`);
			} else if (result.status === "unknown-app") {
				done(
					"skipped",
					`${service}: tccutil cannot find ${bundleId} (LaunchServices skips apps in temporary folders); if "apple-cua-mcp" is still listed in System Settings > Privacy & Security, remove it there`,
				);
			} else {
				const message = `tccutil reset ${service} ${bundleId}: ${result.output}`;
				failures.push(message);
				done("FAILED", `${message} (remove "apple-cua-mcp" in System Settings > Privacy & Security by hand)`);
			}
		}
		if (plan.removeHelper !== undefined) {
			deps.launchServices("unregister", plan.removeHelper);
		}
	}

	if (plan.removeHelper !== undefined) {
		const helper = plan.removeHelper;
		attempt("remove the helper app", () => {
			rmSync(helper, { recursive: true, force: true });
			done("removed", `helper app ${show(helper)}`);
		});
	}
	for (const launcher of plan.removeLaunchers) {
		attempt(`remove ${launcher}`, () => {
			rmSync(launcher, { force: true });
			done("removed", `launcher ${show(launcher)}`);
		});
	}
	for (const rc of plan.removePathLines) {
		attempt(`edit ${rc.path}`, () => {
			const text = readFileSync(rc.path, "utf8");
			const kept = text.split("\n").filter((line) => !line.trimEnd().endsWith(PATH_LINE_MARKER));
			const written = writeConfigFile(rc.path, kept.join("\n"), deps.context.now);
			if (written.backup !== undefined) {
				backups.push(written.backup);
			}
			done("removed", `the PATH line from ${show(rc.path)}`);
		});
	}
	for (const entry of plan.removeState) {
		attempt(`remove ${entry}`, () => {
			rmSync(entry, { recursive: true, force: true });
			done("removed", show(entry));
		});
	}
	if (plan.removeCheckout) {
		attempt(`remove ${layout.checkout}`, () => {
			rmSync(layout.checkout, { recursive: true, force: true });
			done("removed", `checkout ${show(layout.checkout)} (${plan.checkoutReason})`);
		});
	}
	for (const directory of plan.removeIfEmpty) {
		if (!existsSync(directory)) {
			continue;
		}
		const left = readdirSync(directory);
		if (left.length > 0) {
			done("kept", `${show(directory)}: it still holds ${left.join(", ")}, which apple-cua did not create`);
			continue;
		}
		attempt(`remove ${directory}`, () => {
			rmdirSync(directory);
			done("removed", show(directory));
		});
	}
	return { backups, failures };
}

// --- Reading the Mac -----------------------------------------------------------------------------------------------

function bundleIdOf(app: string): string | undefined {
	const result = spawnSync(
		"/usr/bin/plutil",
		["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(app, "Contents/Info.plist")],
		{ encoding: "utf8" },
	);
	const id = result.status === 0 ? result.stdout.trim() : "";
	return id === "" ? undefined : id;
}

/** The checkout a launcher written by setup runs; undefined for any other file. */
function launcherCheckout(text: string): string | undefined {
	const line = text.split("\n").find((entry) => entry.startsWith(LAUNCHER_MARKER));
	return line === undefined ? undefined : canonicalPath(line.slice(LAUNCHER_MARKER.length).trim());
}

function readLaunchers(layout: Layout, env: Environment): UninstallFacts["launchers"] {
	const candidates = [
		layout.launcherPath,
		...(env["PATH"] ?? "")
			.split(delimiter)
			.filter((directory) => directory !== "")
			.map((directory) => join(directory, "apple-cua")),
	];
	const launchers: { path: string; checkout: string | undefined }[] = [];
	for (const candidate of new Set(candidates)) {
		if (!existsSync(candidate)) {
			continue;
		}
		let text = "";
		try {
			text = readFileSync(candidate, "utf8").slice(0, 4096);
		} catch {
			text = "";
		}
		launchers.push({ path: candidate, checkout: launcherCheckout(text) });
	}
	return launchers;
}

function shellStartupFiles(home: string, env: Environment): string[] {
	const zdotdir = env["ZDOTDIR"] !== undefined && env["ZDOTDIR"] !== "" ? env["ZDOTDIR"] : home;
	return [
		...new Set([
			join(zdotdir, ".zshrc"),
			join(zdotdir, ".zprofile"),
			join(home, ".zshrc"),
			join(home, ".bashrc"),
			join(home, ".bash_profile"),
			join(home, ".profile"),
			join(home, ".config/fish/config.fish"),
		]),
	];
}

function listProcesses(): ProcessRow[] {
	const result = spawnSync("/bin/ps", ["-axww", "-o", "pid=,command="], { encoding: "utf8" });
	return (result.stdout ?? "").split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(.*)$/.exec(line);
		return match?.[1] === undefined || match[2] === undefined ? [] : [{ pid: Number(match[1]), command: match[2] }];
	});
}

export function gatherUninstallFacts(layout: Layout, env: Environment): UninstallFacts {
	const marker = readInstallMarker(layout.installMarkerPath);
	let trackedClients: readonly ClientName[];
	try {
		trackedClients = loadSettings(layout.configPath).settings.clients;
	} catch {
		trackedClients = [];
	}
	const context = { home: layout.home, env, now: new Date() };
	const clientEntries = (["omo", "codex", "claude"] as const).map((client): ClientEntryFacts => {
		const { entry } = readClientEntry(client, context);
		const runsThisCheckout = entry !== undefined && entryRunsCheckout(entry, layout.checkout);
		const command = entry?.command;
		return {
			client,
			entry,
			runsThisCheckout,
			alive: entry !== undefined && entryAlive(entry),
			otherHelperBundleId:
				!runsThisCheckout && command?.endsWith(HELPER_EXECUTABLE) === true
					? bundleIdOf(command.slice(0, -HELPER_EXECUTABLE.length))
					: undefined,
		};
	});
	const stopFile = new StopSwitch().path;
	const helperPresent = existsSync(layout.helperApp);
	return {
		layout,
		marker,
		otherInstallerCheckout:
			marker !== undefined && marker.checkout !== layout.checkout && existsSync(marker.checkout)
				? marker.checkout
				: undefined,
		trackedClients,
		clientEntries,
		processes: listProcesses(),
		ownPids: [process.pid, process.ppid],
		helperPresent,
		helperBundleId: (helperPresent ? bundleIdOf(layout.helperApp) : undefined) ?? env["APPLE_CUA_BUNDLE_ID"],
		launchers: readLaunchers(layout, env),
		rcFiles: shellStartupFiles(layout.home, env).flatMap((path) => {
			try {
				const text = readFileSync(path, "utf8");
				return text.includes(PATH_LINE_MARKER) ? [{ path, text }] : [];
			} catch {
				return [];
			}
		}),
		stateEntries: [layout.configPath, layout.installMarkerPath, stopFile, join(layout.appleCuaHome, "node")].filter(
			(path) => existsSync(path),
		),
		stateDirectories: [...new Set([layout.appleCuaHome, dirname(stopFile)])],
		stopPath: stopFile,
	};
}

export function launchServicesWithLsregister(action: "register" | "unregister", app: string): void {
	spawnSync(LSREGISTER, [action === "register" ? "-f" : "-u", app], { stdio: "ignore" });
}

export function resetPermissionWithTccutil(service: string, bundleId: string): PermissionReset {
	const result = spawnSync("/usr/bin/tccutil", ["reset", service, bundleId], { encoding: "utf8" });
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || (result.error?.message ?? "");
	if (result.status === 0) {
		return { status: "reset", output };
	}
	return { status: /No such bundle identifier/i.test(output) ? "unknown-app" : "failed", output };
}
