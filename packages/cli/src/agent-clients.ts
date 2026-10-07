// Gemini CLI, Hermes Agent, OpenClaw and the original pi coding agent. Each is handled like the plugin clients
// (plugin-clients.ts): read what the client's own files say, plan the steps to the target (pure), and let the client's
// own CLI do the work. What the sandbox experiments established about each (.omo/plans/client-integration-spikes.md):
//
//   gemini    `gemini extensions link <plugin dir> --consent` reads the bundle in place, so the MCP server and the
//             skill follow every settings change without a reinstall. Without --consent it waits on a prompt.
//   hermes    `hermes mcp add` connects to the server first and asks "Enable all tools?"; it has no --yes, so Y goes
//             to stdin, and --args must come last. A changed entry is removed and added again.
//   openclaw  `openclaw mcp set <name> <json>` writes mcp.servers; `mcp reload` makes agents pick it up.
//   pi        the original pi (npm @mariozechner/pi-coding-agent) has no MCP; `pi install` adds the apple-cua pi
//             package, which bridges to the MCP server. On many Macs `pi` is senpi (OmO's engine), which is not it.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { MCP_SERVER_NAME, PLUGIN_DIRECTORY, PLUGIN_NAME } from "./bundle.js";
import { type DesiredRegistration, type RegisteredEntry, entryIsCurrent } from "./clients.js";
import { canonicalPath } from "./layout.js";
import { type Env, type PluginPlan, type PluginStep, legacyVerdict } from "./plugin-clients.js";

function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value === "" ? undefined : value;
}

function samePath(left: string | undefined, right: string): boolean {
	return left !== undefined && canonicalPath(left) === canonicalPath(right);
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
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

function toEntry(value: unknown): RegisteredEntry | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const env = record["env"];
	return {
		command: typeof record["command"] === "string" ? record["command"] : undefined,
		args: Array.isArray(record["args"])
			? record["args"].filter((item): item is string => typeof item === "string")
			: [],
		env:
			typeof env === "object" && env !== null && !Array.isArray(env)
				? Object.fromEntries(
						Object.entries(env).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
					)
				: {},
	};
}

function blocked(client: string, entry: RegisteredEntry, howToRemove: string): PluginPlan {
	return {
		steps: [],
		outcome: "unchanged",
		blocked: `an apple-cua MCP entry of another installation (${entry.command ?? "unknown command"}) is registered in ${client}; remove it from that installation (apple-cua uninstall there) or with: ${howToRemove}`,
	};
}

function envPairs(desired: DesiredRegistration): [string, string][] {
	return Object.entries(desired.env).filter((pair): pair is [string, string] => pair[1] !== undefined);
}

// --- Gemini CLI ----------------------------------------------------------------------------------------------------

export interface GeminiState {
	readonly geminiHome: string;
	/** The folder the linked apple-cua extension points to; undefined when no apple-cua extension is installed. */
	readonly linkedSource: string | undefined;
	/** An apple-cua server added with `gemini mcp add -s user` (or by hand) in settings.json. */
	readonly legacy: RegisteredEntry | undefined;
}

export function readGeminiState(home: string): GeminiState {
	const geminiHome = join(home, ".gemini");
	const record = readJson(join(geminiHome, "extensions", PLUGIN_NAME, ".gemini-extension-install.json"));
	const source = field(record, "source");
	return {
		geminiHome,
		linkedSource: typeof source === "string" ? source : undefined,
		legacy: toEntry(field(readJson(join(geminiHome, "settings.json")), "mcpServers", MCP_SERVER_NAME)),
	};
}

export function geminiPluginDir(bundleDir: string): string {
	return join(bundleDir, PLUGIN_DIRECTORY);
}

export function planGeminiInstall(state: GeminiState, bundleDir: string, checkout: string): PluginPlan {
	const verdict = legacyVerdict(state.legacy, checkout);
	if (verdict === "foreign" && state.legacy !== undefined) {
		return blocked("Gemini CLI", state.legacy, `gemini mcp remove -s user ${MCP_SERVER_NAME}`);
	}
	const steps: PluginStep[] = [];
	if (verdict === "migrate") {
		steps.push({
			kind: "run",
			args: ["mcp", "remove", "-s", "user", MCP_SERVER_NAME],
			describe: "removed the older user-scope apple-cua MCP server the extension replaces",
		});
	}
	const pluginDir = geminiPluginDir(bundleDir);
	if (!samePath(state.linkedSource, pluginDir)) {
		if (state.linkedSource !== undefined) {
			steps.push({
				kind: "run",
				args: ["extensions", "uninstall", PLUGIN_NAME],
				describe: `dropped the apple-cua extension that pointed to ${state.linkedSource}`,
			});
		}
		steps.push({
			kind: "run",
			args: ["extensions", "link", pluginDir, "--consent"],
			describe: `linked the apple-cua extension (${pluginDir}); it follows settings changes by itself`,
		});
	}
	return {
		steps,
		outcome: steps.length === 0 ? "unchanged" : state.linkedSource === undefined ? "added" : "updated",
	};
}

export function planGeminiRemove(state: GeminiState, checkout: string): PluginPlan {
	const steps: PluginStep[] = [];
	if (state.linkedSource !== undefined) {
		steps.push({
			kind: "run",
			args: ["extensions", "uninstall", PLUGIN_NAME],
			describe: "removed the apple-cua extension",
		});
	}
	if (legacyVerdict(state.legacy, checkout) === "migrate") {
		steps.push({
			kind: "run",
			args: ["mcp", "remove", "-s", "user", MCP_SERVER_NAME],
			describe: "removed the older user-scope apple-cua MCP server",
		});
	}
	return { steps, outcome: steps.length === 0 ? "absent" : "removed" };
}

// --- Hermes Agent --------------------------------------------------------------------------------------------------

export function hermesHomeOf(home: string, env: Env): string {
	return nonEmpty(env["HERMES_HOME"]) ?? join(home, ".hermes");
}

/**
 * The apple-cua entry under mcp_servers in Hermes' config.yaml, in the block shape `hermes mcp add` writes (command,
 * an args list, an env map). Anything else under the key is still reported as an entry, without its details.
 */
export function readHermesEntry(yaml: string): RegisteredEntry | undefined {
	const lines = yaml.split("\n");
	const top = lines.findIndex((line) => /^mcp_servers:\s*(?:#.*)?$/.test(line));
	if (top === -1) {
		return undefined;
	}
	let start = -1;
	let indent = 0;
	for (let index = top + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^\S/.test(line)) {
			break;
		}
		const match = /^(\s+)(["']?)apple-cua\2:\s*(?:#.*)?$/.exec(line);
		if (match !== null) {
			start = index;
			indent = match[1]?.length ?? 0;
			break;
		}
	}
	if (start === -1) {
		return undefined;
	}
	let command: string | undefined;
	const args: string[] = [];
	const env: Record<string, string> = {};
	let section: "args" | "env" | "other" | undefined;
	const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2");
	for (const line of lines.slice(start + 1)) {
		if (line.trim() === "" || line.trim().startsWith("#")) {
			continue;
		}
		const lead = /^(\s*)/.exec(line)?.[1]?.length ?? 0;
		if (lead <= indent) {
			break;
		}
		const key = /^\s*([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
		if (key !== null && lead === indent + 2) {
			const [, name, value] = key;
			section = name === "args" ? "args" : name === "env" ? "env" : "other";
			if (name === "command") {
				command = unquote(value ?? "");
			}
			continue;
		}
		if (section === "args") {
			const item = /^\s*-\s*(.*)$/.exec(line);
			if (item?.[1] !== undefined) {
				args.push(unquote(item[1]));
			}
		} else if (section === "env" && key?.[1] !== undefined) {
			env[key[1]] = unquote(key[2] ?? "");
		}
	}
	return { command, args, env };
}

export interface HermesState {
	readonly hermesHome: string;
	readonly configExists: boolean;
	readonly entry: RegisteredEntry | undefined;
}

export function readHermesState(home: string, env: Env): HermesState {
	const hermesHome = hermesHomeOf(home, env);
	const path = join(hermesHome, "config.yaml");
	let text: string | undefined;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		text = undefined;
	}
	return {
		hermesHome,
		configExists: text !== undefined,
		entry: text === undefined ? undefined : readHermesEntry(text),
	};
}

function hermesAdd(desired: DesiredRegistration): PluginStep {
	const pairs = envPairs(desired).map(([key, value]) => `${key}=${value}`);
	return {
		kind: "run",
		// --args takes everything after it, so it goes last.
		args: [
			"mcp",
			"add",
			MCP_SERVER_NAME,
			"--command",
			desired.launch.command,
			...(pairs.length === 0 ? [] : ["--env", ...pairs]),
			"--args",
			...desired.launch.args,
		],
		input: "Y\n",
		describe: "added the apple-cua MCP server with all its tools enabled",
	};
}

export function planHermesInstall(state: HermesState, desired: DesiredRegistration, checkout: string): PluginPlan {
	if (state.entry !== undefined && entryIsCurrent(state.entry, desired)) {
		return { steps: [], outcome: "unchanged" };
	}
	const verdict = legacyVerdict(state.entry, checkout);
	if (verdict === "foreign" && state.entry !== undefined) {
		return blocked("Hermes", state.entry, `hermes mcp remove ${MCP_SERVER_NAME}`);
	}
	const steps: PluginStep[] = [];
	if (state.entry !== undefined) {
		steps.push({
			kind: "run",
			args: ["mcp", "remove", MCP_SERVER_NAME],
			input: "Y\n",
			describe: "removed the outdated apple-cua MCP server",
		});
	}
	steps.push(hermesAdd(desired));
	return { steps, outcome: state.entry === undefined ? "added" : "updated" };
}

export function planHermesRemove(state: HermesState, checkout: string): PluginPlan {
	if (state.entry === undefined) {
		return { steps: [], outcome: "absent" };
	}
	if (legacyVerdict(state.entry, checkout) === "foreign") {
		return blocked("Hermes", state.entry, `hermes mcp remove ${MCP_SERVER_NAME}`);
	}
	return {
		steps: [
			{
				kind: "run",
				args: ["mcp", "remove", MCP_SERVER_NAME],
				input: "Y\n",
				describe: "removed the apple-cua MCP server",
			},
		],
		outcome: "removed",
	};
}

// --- OpenClaw ------------------------------------------------------------------------------------------------------

export function openClawStateDirOf(home: string, env: Env): string {
	return nonEmpty(env["OPENCLAW_STATE_DIR"]) ?? join(nonEmpty(env["OPENCLAW_HOME"]) ?? home, ".openclaw");
}

export function openClawConfigPathOf(home: string, env: Env): string {
	return nonEmpty(env["OPENCLAW_CONFIG_PATH"]) ?? join(openClawStateDirOf(home, env), "openclaw.json");
}

export interface OpenClawState {
	readonly entry: RegisteredEntry | undefined;
	/** Why openclaw.json could not be read as JSON; the CLI still edits it. */
	readonly readError?: string | undefined;
	/** Dropping the entry would shrink openclaw.json past OpenClaw's write guard, which no flag lifts. */
	readonly removalRefused?: boolean | undefined;
}

/** OpenClaw refuses to write a config of 512 bytes or more that shrinks below half its size. */
function removalTripsSizeGuard(text: string, config: unknown): boolean {
	const servers = field(config, "mcp", "servers");
	if (typeof servers !== "object" || servers === null) {
		return false;
	}
	const before = Buffer.byteLength(text);
	Reflect.deleteProperty(servers, MCP_SERVER_NAME);
	const after = Buffer.byteLength(`${JSON.stringify(config, null, 2)}\n`);
	return before >= 512 && after < Math.floor(before * 0.5);
}

export function readOpenClawState(home: string, env: Env): OpenClawState {
	const path = openClawConfigPathOf(home, env);
	if (!existsSync(path)) {
		return { entry: undefined };
	}
	const parsed = readJson(path);
	if (parsed === undefined) {
		return { entry: undefined, readError: `${path} is not plain JSON` };
	}
	const entry = toEntry(field(parsed, "mcp", "servers", MCP_SERVER_NAME));
	return { entry, removalRefused: entry !== undefined && removalTripsSizeGuard(readFileSync(path, "utf8"), parsed) };
}

export function planOpenClawInstall(state: OpenClawState, desired: DesiredRegistration, checkout: string): PluginPlan {
	if (state.entry !== undefined && entryIsCurrent(state.entry, desired)) {
		return { steps: [], outcome: "unchanged" };
	}
	if (legacyVerdict(state.entry, checkout) === "foreign" && state.entry !== undefined) {
		return blocked("OpenClaw", state.entry, `openclaw mcp unset ${MCP_SERVER_NAME}`);
	}
	const server = {
		command: desired.launch.command,
		args: [...desired.launch.args],
		...(envPairs(desired).length === 0 ? {} : { env: Object.fromEntries(envPairs(desired)) }),
	};
	return {
		steps: [
			{
				kind: "run",
				args: ["mcp", "set", MCP_SERVER_NAME, JSON.stringify(server)],
				describe: `${state.entry === undefined ? "added" : "updated"} the apple-cua MCP server in openclaw.json`,
			},
			{ kind: "run", args: ["mcp", "reload"], describe: "told running OpenClaw agents to reload their MCP servers" },
		],
		outcome: state.entry === undefined ? "added" : "updated",
	};
}

export function planOpenClawRemove(state: OpenClawState, checkout: string): PluginPlan {
	if (state.entry === undefined) {
		return { steps: [], outcome: "absent" };
	}
	if (legacyVerdict(state.entry, checkout) === "foreign") {
		return blocked("OpenClaw", state.entry, `openclaw mcp unset ${MCP_SERVER_NAME}`);
	}
	if (state.removalRefused === true) {
		return {
			steps: [],
			outcome: "unchanged",
			blocked: `OpenClaw refuses to write openclaw.json when it shrinks below half its size, and the ${MCP_SERVER_NAME} entry is most of it; delete mcp.servers.${MCP_SERVER_NAME} from openclaw.json by hand, or run \`openclaw mcp unset ${MCP_SERVER_NAME}\` once OpenClaw holds more settings`,
		};
	}
	return {
		steps: [
			{ kind: "run", args: ["mcp", "unset", MCP_SERVER_NAME], describe: "removed the apple-cua MCP server" },
			{ kind: "run", args: ["mcp", "reload"], describe: "told running OpenClaw agents to reload their MCP servers" },
		],
		outcome: "removed",
	};
}

// --- pi (the original) ---------------------------------------------------------------------------------------------

export const PI_PACKAGE = "@mariozechner/pi-coding-agent";

export function piAgentDirOf(home: string, env: Env): string {
	return nonEmpty(env["PI_CODING_AGENT_DIR"]) ?? join(home, ".pi/agent");
}

/** Whether `binary` is the original pi: its real path lies in the @mariozechner/pi-coding-agent package. */
export function isOriginalPi(binary: string): boolean {
	try {
		return realpathSync(binary).includes(`/${PI_PACKAGE}/`);
	} catch {
		return false;
	}
}

export function piPackageDir(checkout: string): string {
	return join(checkout, "packages/pi-extension");
}

export interface PiState {
	readonly settingsPath: string;
	/** The installed packages, as absolute paths (pi stores local ones relative to settings.json). */
	readonly packages: readonly string[];
}

export function readPiState(home: string, env: Env): PiState {
	const settingsPath = join(piAgentDirOf(home, env), "settings.json");
	const packages = field(readJson(settingsPath), "packages");
	return {
		settingsPath,
		packages: Array.isArray(packages)
			? packages
					.filter((item): item is string => typeof item === "string")
					.map((item) => (/^[a-z]+:/i.test(item) ? item : resolve(dirname(settingsPath), item)))
			: [],
	};
}

export function planPiInstall(state: PiState, checkout: string): PluginPlan {
	const packageDir = piPackageDir(checkout);
	if (state.packages.some((item) => samePath(item, packageDir))) {
		return { steps: [], outcome: "unchanged" };
	}
	return {
		steps: [
			{
				kind: "run",
				args: ["install", packageDir],
				describe: `installed the apple-cua pi package (${packageDir}); it reaches the MCP server through the bundle`,
			},
		],
		outcome: "added",
	};
}

export function planPiRemove(state: PiState, checkout: string): PluginPlan {
	const packageDir = piPackageDir(checkout);
	if (!state.packages.some((item) => samePath(item, packageDir))) {
		return { steps: [], outcome: "absent" };
	}
	return {
		steps: [{ kind: "run", args: ["remove", packageDir], describe: "removed the apple-cua pi package" }],
		outcome: "removed",
	};
}
