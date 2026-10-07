// Codex and Claude Code get apple-cua as a plugin from the per-Mac bundle (see bundle.ts): a local marketplace that
// points at the bundle, and the apple-cua plugin installed from it, carrying the MCP server and the skill together.
//
// Each client is handled in three steps that keep the decisions testable without the real CLIs:
//   read*State  what the client's own files say now (never runs the CLI),
//   plan*       the steps from that state to the target (pure),
//   runSteps    the client's own CLI does the work, so its caches and bookkeeping stay consistent.
//
// An older hand-written MCP entry named apple-cua has to go: Codex lets it shadow the plugin's server, and Claude Code
// would run both. It is removed when it runs this checkout or nothing at all; another live installation's entry is
// left alone and reported, because removing it would break that installation.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MARKETPLACE_NAME, PLUGIN_NAME } from "./bundle.js";
import { type RegisteredEntry, entryAlive, entryRunsCheckout } from "./clients.js";
import { canonicalPath } from "./layout.js";

export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const CLI_TIMEOUT_MS = 120_000;

export type Env = Readonly<Record<string, string | undefined>>;

export interface CliResult {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

export type CliRunner = (command: string, args: readonly string[], env: Env, input?: string) => CliResult;

export const runCli: CliRunner = (command, args, env, input) => {
	const result = spawnSync(command, [...args], {
		encoding: "utf8",
		env: { ...env },
		timeout: CLI_TIMEOUT_MS,
		...(input === undefined ? { stdio: ["ignore", "pipe", "pipe"] as const } : { input }),
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.error === undefined ? (result.stderr ?? "") : result.error.message,
	};
};

export interface PluginTarget {
	readonly bundleDir: string;
	readonly version: string;
	readonly checkout: string;
}

function samePath(left: string | undefined, right: string): boolean {
	return left !== undefined && canonicalPath(left) === canonicalPath(right);
}

export type LegacyVerdict = "none" | "migrate" | "foreign";

/** What to do with an older MCP entry named apple-cua: nothing, remove it (ours or dead), or leave it (another live installation). */
export function legacyVerdict(entry: RegisteredEntry | undefined, checkout: string): LegacyVerdict {
	if (entry === undefined) {
		return "none";
	}
	return entryRunsCheckout(entry, canonicalPath(checkout)) || !entryAlive(entry) ? "migrate" : "foreign";
}

export type PluginStep =
	| {
			readonly kind: "run";
			readonly args: readonly string[];
			readonly describe: string;
			/** Typed into the command's stdin, for CLIs that confirm with a prompt. */
			readonly input?: string | undefined;
	  }
	| { readonly kind: "mkdir"; readonly path: string; readonly describe: string }
	| { readonly kind: "delete"; readonly path: string; readonly describe: string }
	| { readonly kind: "remove-legacy"; readonly describe: string };

export interface PluginPlan {
	readonly steps: readonly PluginStep[];
	/** Why nothing can be done until a person acts; the steps are empty then. */
	readonly blocked?: string | undefined;
	/** "added" when the plugin was not installed, "updated" when it changes, "unchanged" when there is nothing to do. */
	readonly outcome: "added" | "updated" | "unchanged" | "removed" | "absent";
}

function foreignLegacyMessage(client: string, entry: RegisteredEntry, howToRemove: string): string {
	return `an apple-cua MCP entry of another installation (${entry.command ?? "unknown command"}) is registered in ${client}; it would ${client === "Codex" ? "hide" : "run beside"} the plugin's server. Remove it from that installation (apple-cua uninstall there) or with: ${howToRemove}`;
}

// --- Codex ----------------------------------------------------------------------------------------------------------

export interface CodexState {
	readonly codexHome: string;
	readonly homeExists: boolean;
	/** source of [marketplaces.apple-cua-local] in config.toml. */
	readonly marketplaceSource: string | undefined;
	/** [plugins."apple-cua@apple-cua-local"]: undefined when absent. */
	readonly plugin: { readonly enabled: boolean } | undefined;
	/** The plugin versions in Codex's cache. */
	readonly cachedVersions: readonly string[];
	readonly legacy: RegisteredEntry | undefined;
}

export function codexHomeOf(home: string, env: Env): string {
	const custom = env["CODEX_HOME"];
	return custom !== undefined && custom !== "" ? custom : join(home, ".codex");
}

function tomlTable(text: string, header: RegExp): string[] | undefined {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => header.test(line));
	if (start === -1) {
		return undefined;
	}
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^\s*\[/.test(line)) {
			break;
		}
		body.push(line);
	}
	return body;
}

function tomlStringValue(body: readonly string[], key: string): string | undefined {
	for (const line of body) {
		const match = new RegExp(`^\\s*${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(line);
		if (match?.[1] !== undefined) {
			return JSON.parse(`"${match[1]}"`) as string;
		}
	}
	return undefined;
}

function tomlBooleanValue(body: readonly string[], key: string): boolean | undefined {
	for (const line of body) {
		const match = new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\b`).exec(line);
		if (match?.[1] !== undefined) {
			return match[1] === "true";
		}
	}
	return undefined;
}

function listDirectories(path: string): string[] {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

export function readCodexState(home: string, env: Env, legacy: RegisteredEntry | undefined): CodexState {
	const codexHome = codexHomeOf(home, env);
	let text = "";
	try {
		text = readFileSync(join(codexHome, "config.toml"), "utf8");
	} catch {
		text = "";
	}
	const marketplace = tomlTable(text, new RegExp(`^\\s*\\[\\s*marketplaces\\s*\\.\\s*"?${MARKETPLACE_NAME}"?\\s*\\]`));
	const plugin = tomlTable(text, new RegExp(`^\\s*\\[\\s*plugins\\s*\\.\\s*"${PLUGIN_ID}"\\s*\\]`));
	return {
		codexHome,
		homeExists: existsSync(codexHome),
		marketplaceSource: marketplace === undefined ? undefined : tomlStringValue(marketplace, "source"),
		plugin: plugin === undefined ? undefined : { enabled: tomlBooleanValue(plugin, "enabled") ?? true },
		cachedVersions: listDirectories(join(codexHome, "plugins/cache", MARKETPLACE_NAME, PLUGIN_NAME)),
		legacy,
	};
}

export function planCodexInstall(state: CodexState, target: PluginTarget): PluginPlan {
	const steps: PluginStep[] = [];
	const verdict = legacyVerdict(state.legacy, target.checkout);
	if (verdict === "foreign" && state.legacy !== undefined) {
		return {
			steps: [],
			outcome: "unchanged",
			blocked: foreignLegacyMessage("Codex", state.legacy, "codex mcp remove apple-cua"),
		};
	}
	if (verdict === "migrate") {
		steps.push({
			kind: "remove-legacy",
			describe: "removed the older [mcp_servers.apple-cua] entry the plugin replaces",
		});
	}
	if (!state.homeExists) {
		steps.push({ kind: "mkdir", path: state.codexHome, describe: `created ${state.codexHome}` });
	}
	if (!samePath(state.marketplaceSource, target.bundleDir)) {
		if (state.marketplaceSource !== undefined) {
			steps.push({
				kind: "run",
				args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME],
				describe: `dropped the ${MARKETPLACE_NAME} marketplace at ${state.marketplaceSource}`,
			});
		}
		steps.push({
			kind: "run",
			args: ["plugin", "marketplace", "add", target.bundleDir],
			describe: `added the ${MARKETPLACE_NAME} marketplace (${target.bundleDir})`,
		});
	}
	const current =
		state.plugin?.enabled === true &&
		state.cachedVersions.includes(target.version) &&
		samePath(state.marketplaceSource, target.bundleDir);
	if (!current) {
		steps.push({
			kind: "run",
			args: ["plugin", "add", PLUGIN_ID],
			describe: `installed the ${PLUGIN_NAME} plugin ${target.version}`,
		});
	}
	const installed = state.plugin !== undefined && state.cachedVersions.length > 0;
	return { steps, outcome: steps.length === 0 ? "unchanged" : installed ? "updated" : "added" };
}

export function planCodexRemove(state: CodexState, checkout: string): PluginPlan {
	const steps: PluginStep[] = [];
	if (state.plugin !== undefined) {
		steps.push({ kind: "run", args: ["plugin", "remove", PLUGIN_ID], describe: `removed the ${PLUGIN_NAME} plugin` });
	}
	if (state.marketplaceSource !== undefined) {
		steps.push({
			kind: "run",
			args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME],
			describe: `removed the ${MARKETPLACE_NAME} marketplace`,
		});
	}
	if (legacyVerdict(state.legacy, checkout) === "migrate") {
		steps.push({ kind: "remove-legacy", describe: "removed the older [mcp_servers.apple-cua] entry" });
	}
	const cache = join(state.codexHome, "plugins/cache", MARKETPLACE_NAME);
	if (existsSync(cache)) {
		steps.push({ kind: "delete", path: cache, describe: `deleted Codex's cached copies (${cache})` });
	}
	return { steps, outcome: steps.length === 0 ? "absent" : "removed" };
}

// --- Claude Code ---------------------------------------------------------------------------------------------------

export interface ClaudeState {
	readonly configDir: string;
	/** extraKnownMarketplaces["apple-cua-local"].source.path in settings.json. */
	readonly marketplacePath: string | undefined;
	/** The user-scope install recorded in plugins/installed_plugins.json. */
	readonly installedVersion: string | undefined;
	/** enabledPlugins["apple-cua@apple-cua-local"] in settings.json; undefined when not mentioned. */
	readonly enabled: boolean | undefined;
	readonly legacy: RegisteredEntry | undefined;
}

export function claudeConfigDirOf(home: string, env: Env): string {
	const custom = env["CLAUDE_CONFIG_DIR"];
	return custom !== undefined && custom !== "" ? custom : join(home, ".claude");
}

function readJsonObject(path: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function field(value: unknown, ...path: readonly string[]): unknown {
	let current = value;
	for (const key of path) {
		if (typeof current !== "object" || current === null || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

export function readClaudeState(home: string, env: Env, legacy: RegisteredEntry | undefined): ClaudeState {
	const configDir = claudeConfigDirOf(home, env);
	const settings = readJsonObject(join(configDir, "settings.json"));
	const installed = field(readJsonObject(join(configDir, "plugins/installed_plugins.json")), "plugins", PLUGIN_ID);
	const userInstall = Array.isArray(installed)
		? installed.find((entry) => field(entry, "scope") === "user")
		: undefined;
	const marketplacePath = field(settings, "extraKnownMarketplaces", MARKETPLACE_NAME, "source", "path");
	const enabled = field(settings, "enabledPlugins", PLUGIN_ID);
	const version = field(userInstall, "version");
	return {
		configDir,
		marketplacePath: typeof marketplacePath === "string" ? marketplacePath : undefined,
		installedVersion: typeof version === "string" ? version : undefined,
		enabled: typeof enabled === "boolean" ? enabled : undefined,
		legacy,
	};
}

export function planClaudeInstall(state: ClaudeState, target: PluginTarget, explicit: boolean): PluginPlan {
	const steps: PluginStep[] = [];
	const verdict = legacyVerdict(state.legacy, target.checkout);
	if (verdict === "foreign" && state.legacy !== undefined) {
		return {
			steps: [],
			outcome: "unchanged",
			blocked: foreignLegacyMessage("Claude Code", state.legacy, "claude mcp remove apple-cua --scope user"),
		};
	}
	if (verdict === "migrate") {
		steps.push({
			kind: "remove-legacy",
			describe: "removed the older user-scope apple-cua MCP server the plugin replaces",
		});
	}
	const marketplaceMoved = !samePath(state.marketplacePath, target.bundleDir);
	if (marketplaceMoved) {
		if (state.marketplacePath !== undefined) {
			steps.push({
				kind: "run",
				args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME],
				describe: `dropped the ${MARKETPLACE_NAME} marketplace at ${state.marketplacePath}`,
			});
		}
		steps.push({
			kind: "run",
			args: ["plugin", "marketplace", "add", target.bundleDir],
			describe: `added the ${MARKETPLACE_NAME} marketplace (${target.bundleDir})`,
		});
	}
	if (state.installedVersion === undefined || (marketplaceMoved && state.marketplacePath !== undefined)) {
		steps.push({
			kind: "run",
			args: ["plugin", "install", PLUGIN_ID, "--scope", "user", "-y"],
			describe: `installed the ${PLUGIN_NAME} plugin ${target.version}`,
		});
	} else if (state.installedVersion !== target.version) {
		if (!marketplaceMoved) {
			steps.push({
				kind: "run",
				args: ["plugin", "marketplace", "update", MARKETPLACE_NAME],
				describe: `refreshed the ${MARKETPLACE_NAME} marketplace`,
			});
		}
		steps.push({
			kind: "run",
			args: ["plugin", "update", PLUGIN_ID],
			describe: `updated the ${PLUGIN_NAME} plugin ${state.installedVersion} -> ${target.version}`,
		});
	}
	if (state.enabled === false && explicit) {
		steps.push({ kind: "run", args: ["plugin", "enable", PLUGIN_ID], describe: `enabled the ${PLUGIN_NAME} plugin` });
	}
	return {
		steps,
		outcome: steps.length === 0 ? "unchanged" : state.installedVersion === undefined ? "added" : "updated",
	};
}

export function planClaudeRemove(state: ClaudeState, checkout: string): PluginPlan {
	const steps: PluginStep[] = [];
	if (state.installedVersion !== undefined || state.enabled !== undefined) {
		steps.push({
			kind: "run",
			args: ["plugin", "uninstall", PLUGIN_ID, "--scope", "user"],
			describe: `uninstalled the ${PLUGIN_NAME} plugin`,
		});
	}
	if (state.marketplacePath !== undefined) {
		steps.push({
			kind: "run",
			args: ["plugin", "marketplace", "remove", MARKETPLACE_NAME],
			describe: `removed the ${MARKETPLACE_NAME} marketplace`,
		});
	}
	if (legacyVerdict(state.legacy, checkout) === "migrate") {
		steps.push({ kind: "remove-legacy", describe: "removed the older user-scope apple-cua MCP server" });
	}
	const cache = join(state.configDir, "plugins/cache", MARKETPLACE_NAME);
	if (existsSync(cache)) {
		steps.push({ kind: "delete", path: cache, describe: `deleted Claude Code's cached copies (${cache})` });
	}
	return { steps, outcome: steps.length === 0 ? "absent" : "removed" };
}

// --- Running a plan ------------------------------------------------------------------------------------------------

export interface StepRunner {
	readonly cli: string;
	readonly env: Env;
	readonly run: CliRunner;
	readonly removeLegacy: () => void;
}

export function runSteps(plan: PluginPlan, runner: StepRunner): string[] {
	const done: string[] = [];
	for (const step of plan.steps) {
		switch (step.kind) {
			case "run": {
				const result = runner.run(runner.cli, step.args, runner.env, step.input);
				if (result.status !== 0) {
					const output = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" | ");
					throw new Error(
						`${[runner.cli, ...step.args].join(" ")} failed (${result.status === null ? "timed out" : `exit ${result.status}`}): ${output}${done.length > 0 ? `; already done: ${done.join("; ")}` : ""}`,
					);
				}
				break;
			}
			case "mkdir":
				mkdirSync(step.path, { recursive: true });
				break;
			case "delete":
				rmSync(step.path, { recursive: true, force: true });
				break;
			case "remove-legacy":
				runner.removeLegacy();
				break;
		}
		done.push(step.describe);
	}
	return done;
}

/** Whether the installed CLI has the plugin commands (Codex 0.117+, Claude Code with plugins). */
export function supportsPlugins(cli: string, env: Env, run: CliRunner = runCli): boolean {
	return run(cli, ["plugin", "--help"], env).status === 0;
}
