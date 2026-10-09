// MCP client registration: writes, checks and removes the "apple-cua" entry in each client's configuration.
//
//   omo     ~/.omo/agent/mcp.json            mcpServers["apple-cua"]
//   claude  `claude mcp add --scope user`    (prints the JSON block when the claude CLI is not installed)
//   codex   ~/.codex/config.toml             [mcp_servers.apple-cua]
//   json    prints a block to paste into any other client's configuration
//
// Config files are merged, never replaced: other servers and settings stay as they are, and unknown keys of an
// existing apple-cua entry are kept. A file that would change is first copied to <file>.bak-<timestamp>; a file that
// already says the same thing is not touched.

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import {
	hermesHomeOf,
	isOriginalPi,
	openClawConfigPathOf,
	planGeminiInstall,
	planGeminiRemove,
	planHermesInstall,
	planHermesRemove,
	planOpenClawInstall,
	planOpenClawRemove,
	planPiInstall,
	planPiRemove,
	readGeminiState,
	readHermesEntry,
	readHermesState,
	readOpenClawState,
	readPiState,
} from "./agent-clients.js";
import { canonicalPath, isInside } from "./layout.js";
import {
	type CliRunner,
	type PluginPlan,
	type PluginTarget,
	planClaudeInstall,
	planClaudeRemove,
	planCodexInstall,
	planCodexRemove,
	readClaudeState,
	readCodexState,
	runCli,
	runSteps,
	supportsPlugins,
} from "./plugin-clients.js";

const SERVER_NAME = "apple-cua";
export const CLIENT_NAMES = ["omo", "claude", "codex", "gemini", "cursor", "hermes", "openclaw", "pi", "json"] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];

/** How each client is named to a person. */
export const CLIENT_LABELS: Readonly<Record<ClientName, string>> = {
	omo: "OmO",
	claude: "Claude Code",
	codex: "Codex",
	gemini: "Gemini CLI",
	cursor: "Cursor",
	hermes: "Hermes Agent",
	openclaw: "OpenClaw",
	pi: "pi",
	json: "any other MCP client (a printed JSON block)",
};

export interface DetectedClient {
	readonly client: ClientName;
	/** Why it counts as installed: its CLI on PATH, or its configuration folder. */
	readonly how: string;
}

/** The agent clients this Mac has: the CLI on PATH, or the configuration folder (honoring CODEX_HOME and CLAUDE_CONFIG_DIR). */
export function detectClients(context: ClientContext): DetectedClient[] {
	const found: DetectedClient[] = [];
	const probe = (client: ClientName, cli: string, folders: readonly string[]) => {
		const binary = findExecutable(cli, context.env["PATH"]);
		const folder = folders.find((path) => existsSync(path));
		if (binary !== undefined) {
			found.push({ client, how: `${cli} on PATH (${binary})` });
		} else if (folder !== undefined) {
			found.push({ client, how: `its settings in ${folder}` });
		}
	};
	probe("codex", "codex", [nonEmpty(context.env["CODEX_HOME"]) ?? join(context.home, ".codex")]);
	probe("claude", "claude", [
		nonEmpty(context.env["CLAUDE_CONFIG_DIR"]) ?? join(context.home, ".claude"),
		join(context.home, ".claude.json"),
	]);
	probe("omo", "omo", [join(context.home, ".omo")]);
	probe("gemini", "gemini", [join(context.home, ".gemini")]);
	probe("cursor", "cursor-agent", [join(context.home, ".cursor")]);
	const hermes = agentCli("hermes", context);
	if (hermes !== undefined) {
		found.push({ client: "hermes", how: `hermes CLI (${hermes})` });
	} else if (existsSync(join(hermesHomeOf(context.home, context.env), "config.yaml"))) {
		found.push({ client: "hermes", how: "its settings (its CLI is not installed yet)" });
	}
	const openclaw = agentCli("openclaw", context);
	if (openclaw !== undefined) {
		found.push({ client: "openclaw", how: `openclaw CLI (${openclaw})` });
	} else if (existsSync(openClawConfigPathOf(context.home, context.env))) {
		found.push({ client: "openclaw", how: "its settings (its CLI is not installed yet)" });
	}
	const pi = agentCli("pi", context);
	if (pi !== undefined) {
		found.push({ client: "pi", how: `pi on PATH (${pi})` });
	}
	return found;
}

export function isClientName(value: string): value is ClientName {
	return CLIENT_NAMES.some((name) => name === value);
}

export interface LaunchCommand {
	readonly command: string;
	readonly args: readonly string[];
}

/** Environment values to write; undefined removes the key. */
export type EnvUpdate = Readonly<Record<string, string | undefined>>;
export type EnvMap = Readonly<Record<string, string>>;

/** What one registration should say. */
export interface DesiredRegistration {
	readonly launch: LaunchCommand;
	/** Written into the entry's env on top of the keys it already has. */
	readonly env: EnvUpdate;
	/** True when an entry's env already means what `env` says, so the entry needs no rewrite. */
	readonly envSatisfied: (env: EnvMap) => boolean;
	/** The bundle plugin clients (Codex, Claude Code) install from; without it they get a plain MCP entry. */
	readonly bundle?: PluginTarget | undefined;
	/** A person asked for this client now (config --register), as opposed to a settings refresh. */
	readonly explicit?: boolean | undefined;
}

export interface ClientContext {
	readonly home: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly now: Date;
	/** Runs a client's CLI; tests replace it. */
	readonly run?: CliRunner | undefined;
}

/** An apple-cua entry as a client configuration holds it. */
export interface RegisteredEntry {
	readonly command: string | undefined;
	readonly args: readonly string[];
	readonly env: EnvMap;
	readonly lifecycle?: string | undefined;
	readonly requestTimeoutMs?: number | undefined;
}

type JsonObject = Record<string, unknown>;

export type ChangeAction = "added" | "updated" | "unchanged" | "removed" | "absent" | "printed" | "manual";

export interface ClientChange {
	readonly client: ClientName;
	readonly action: ChangeAction;
	readonly path?: string | undefined;
	readonly backup?: string | undefined;
	readonly before?: RegisteredEntry | undefined;
	readonly after?: JsonObject | undefined;
	readonly printed?: JsonObject | undefined;
	readonly note?: string | undefined;
	/** What a plugin install or removal did, in order. */
	readonly steps?: readonly string[] | undefined;
	/** What the person has to do for a running client to pick the change up. */
	readonly restart?: string | undefined;
}

export type RegistrationState = "current" | "stale" | "missing" | "unreadable" | "manual" | "disabled" | "conflict";

export interface ClientInspection {
	readonly client: ClientName;
	readonly state: RegistrationState;
	readonly path?: string | undefined;
	readonly entry?: RegisteredEntry | undefined;
	readonly detail: string;
}

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
	if (!isPlainObject(value)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
	);
}

function toRegisteredEntry(value: unknown): RegisteredEntry | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	const command = value["command"];
	const args = value["args"];
	const lifecycle = value["lifecycle"];
	const requestTimeoutMs = value["requestTimeoutMs"];
	return {
		command: typeof command === "string" ? command : undefined,
		args: Array.isArray(args) ? args.filter((argument): argument is string => typeof argument === "string") : [],
		env: stringRecord(value["env"]),
		...(typeof lifecycle === "string" ? { lifecycle } : {}),
		...(typeof requestTimeoutMs === "number" ? { requestTimeoutMs } : {}),
	};
}

export function entryIsCurrent(entry: RegisteredEntry, desired: DesiredRegistration): boolean {
	return (
		entry.command === desired.launch.command &&
		entry.args.length === desired.launch.args.length &&
		entry.args.every((argument, index) => argument === desired.launch.args[index]) &&
		desired.envSatisfied(entry.env)
	);
}

function absolutePaths(entry: RegisteredEntry): string[] {
	return [entry.command, ...entry.args].filter((value): value is string => value?.startsWith("/") === true);
}

/** Whether an entry runs something inside `checkout`: its helper app, or node with its server.js. */
export function entryRunsCheckout(entry: RegisteredEntry, checkout: string): boolean {
	return absolutePaths(entry).some((path) => isInside(canonicalPath(path), checkout));
}

/** Whether what an entry runs still exists; an entry left behind by a deleted checkout does not. */
export function entryAlive(entry: RegisteredEntry): boolean {
	const paths = absolutePaths(entry);
	return paths.length === 0 || paths.some((path) => existsSync(path));
}

/** `existing` with `update` applied: changed keys keep their place, new ones go last, undefined ones are dropped. */
function applyEnvUpdate(existing: JsonObject, update: EnvUpdate): JsonObject {
	const pairs: [string, unknown][] = [];
	for (const [key, value] of Object.entries(existing)) {
		if (!(key in update)) {
			pairs.push([key, value]);
			continue;
		}
		const next = update[key];
		if (next !== undefined) {
			pairs.push([key, next]);
		}
	}
	for (const [key, value] of Object.entries(update)) {
		if (value !== undefined && !(key in existing)) {
			pairs.push([key, value]);
		}
	}
	return Object.fromEntries(pairs);
}

/** The desired launch command and env on top of an existing entry, whose other keys (type, enabled, ...) are kept. */
function mergeServerEntry(existing: unknown, desired: DesiredRegistration): JsonObject {
	const base = isPlainObject(existing) ? existing : {};
	const env = applyEnvUpdate(isPlainObject(base["env"]) ? base["env"] : {}, desired.env);
	const merged: JsonObject = { ...base, command: desired.launch.command, args: [...desired.launch.args], env };
	return Object.fromEntries(Object.entries(merged).filter(([key]) => key !== "env" || Object.keys(env).length > 0));
}

interface FileEdit {
	readonly text: string;
	readonly changed: boolean;
	readonly before: RegisteredEntry | undefined;
	readonly after?: JsonObject | undefined;
}

// --- JSON configs keyed by mcpServers (omo, Claude Code) ---------------------------------------------------------

function detectIndent(text: string | undefined): string {
	const match = /^([ \t]+)\S/m.exec(text ?? "");
	return match?.[1] ?? "  ";
}

function parseJsonConfig(text: string | undefined): { config: JsonObject; servers: JsonObject } {
	const parsed: unknown = text === undefined || text.trim() === "" ? {} : JSON.parse(text);
	if (!isPlainObject(parsed)) {
		throw new Error("the top level is not a JSON object");
	}
	const servers = parsed["mcpServers"] ?? {};
	if (!isPlainObject(servers)) {
		throw new Error("mcpServers is not an object");
	}
	return { config: parsed, servers };
}

function mergeJsonConfig(text: string | undefined, desired: DesiredRegistration, client: "omo" | "cursor"): FileEdit {
	const { config, servers } = parseJsonConfig(text);
	const before = toRegisteredEntry(servers[SERVER_NAME]);
	const needsLifecycle = client === "omo" && before?.lifecycle === undefined;
	const needsTimeout = client === "omo" && before?.requestTimeoutMs === undefined;
	if (
		text !== undefined &&
		before !== undefined &&
		entryIsCurrent(before, desired) &&
		!needsLifecycle &&
		!needsTimeout
	) {
		return { text, changed: false, before };
	}
	const after = mergeServerEntry(servers[SERVER_NAME], desired);
	if (needsLifecycle) {
		// OmO's implicit lazy lifecycle closes idle stdio servers after ten minutes,
		// destroying the observation tokens that a later action still needs.
		after["lifecycle"] = "keep-alive";
	}
	if (needsTimeout) {
		// Scripts can run for 120 seconds; allow time for their final observation too.
		after["requestTimeoutMs"] = 180_000;
	}
	const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: after } };
	return { text: `${JSON.stringify(next, null, detectIndent(text))}\n`, changed: true, before, after };
}

function removeFromJsonConfig(text: string | undefined): FileEdit {
	if (text === undefined) {
		return { text: "", changed: false, before: undefined };
	}
	const { config, servers } = parseJsonConfig(text);
	if (!(SERVER_NAME in servers)) {
		return { text, changed: false, before: undefined };
	}
	const before = toRegisteredEntry(servers[SERVER_NAME]);
	const remaining = Object.fromEntries(Object.entries(servers).filter(([key]) => key !== SERVER_NAME));
	const next = { ...config, mcpServers: remaining };
	return { text: `${JSON.stringify(next, null, detectIndent(text))}\n`, changed: true, before };
}

// --- Codex config.toml -------------------------------------------------------------------------------------------

const NAME = `(?:${SERVER_NAME}|"${SERVER_NAME}"|'${SERVER_NAME}')`;
const OUR_TABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${NAME}\\s*\\]\\s*(?:#.*)?$`);
const OUR_SUBTABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${NAME}\\s*\\.\\s*([^\\]]+?)\\s*\\]\\s*(?:#.*)?$`);
const OTHER_FORM = new RegExp(`^\\s*(?:mcp_servers\\s*\\.\\s*)?${NAME}\\s*(?:\\.|=)`);
const HEADER = /^\s*\[\[?[^[\]]+\]\]?\s*(?:#.*)?$/;
const BLANK_OR_COMMENT = /^\s*(?:#.*)?$/;
const BASIC_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const LITERAL_STRING = String.raw`'[^']*'`;
const KEY = String.raw`[A-Za-z0-9_-]+|${BASIC_STRING}`;
const KEY_VALUE = new RegExp(`^\\s*(${KEY})\\s*=\\s*(${BASIC_STRING}|${LITERAL_STRING})\\s*(?:#.*)?$`);

function tomlKey(key: string): string {
	return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function parseTomlString(token: string): string {
	if (token.startsWith("'")) {
		return token.slice(1, -1);
	}
	const parsed: unknown = JSON.parse(token);
	return typeof parsed === "string" ? parsed : token;
}

function parseTomlKey(token: string): string {
	return token.startsWith('"') ? parseTomlString(token) : token;
}

function parseInlineTable(body: string, path: string): Record<string, string> {
	const pair = new RegExp(`\\s*(${KEY})\\s*=\\s*(${BASIC_STRING}|${LITERAL_STRING})\\s*(,|$)`, "y");
	const values: Record<string, string> = {};
	const inner = body.trim();
	while (pair.lastIndex < inner.length) {
		const start = pair.lastIndex;
		const match = pair.exec(inner);
		if (match === null || match.index !== start || match[1] === undefined || match[2] === undefined) {
			throw new Error(`cannot read the env table of [mcp_servers.${SERVER_NAME}] in ${path}; edit it by hand`);
		}
		values[parseTomlKey(match[1])] = parseTomlString(match[2]);
	}
	return values;
}

/** How many lines a value starting on line `index` spans (multi-line arrays, inline tables and strings). */
function valueLineCount(lines: readonly string[], index: number): number {
	let depth = 0;
	let multiline: string | null = null;
	for (let cursor = index; cursor < lines.length; cursor += 1) {
		let text = lines[cursor] ?? "";
		if (cursor === index) {
			text = text.slice(text.indexOf("=") + 1);
		}
		for (let position = 0; position < text.length; position += 1) {
			const rest = text.slice(position);
			if (multiline !== null) {
				if (rest.startsWith(multiline)) {
					position += 2;
					multiline = null;
				}
				continue;
			}
			if (rest.startsWith('"""') || rest.startsWith("'''")) {
				multiline = rest.slice(0, 3);
				position += 2;
			} else if (rest.startsWith("#")) {
				break;
			} else if (rest[0] === '"' || rest[0] === "'") {
				const quote = rest[0];
				let end = 1;
				while (end < rest.length && rest[end] !== quote) {
					end += quote === '"' && rest[end] === "\\" ? 2 : 1;
				}
				position += end;
			} else if (rest[0] === "[" || rest[0] === "{") {
				depth += 1;
			} else if (rest[0] === "]" || rest[0] === "}") {
				depth -= 1;
			}
		}
		if (depth <= 0 && multiline === null) {
			return cursor - index + 1;
		}
	}
	return lines.length - index;
}

function parseStringArray(text: string): string[] {
	return [...text.matchAll(new RegExp(`${BASIC_STRING}|${LITERAL_STRING}`, "g"))].map((match) =>
		parseTomlString(match[0]),
	);
}

interface CodexTable {
	readonly lines: readonly string[];
	/** -1 when the file has no [mcp_servers.apple-cua] table. */
	readonly start: number;
	/** One past the table's last line, sub-tables included, trailing blank and comment lines excluded. */
	readonly end: number;
	readonly before: RegisteredEntry | undefined;
	readonly env: Record<string, string>;
	readonly extras: readonly string[];
	readonly subtables: readonly (readonly string[])[];
}

/**
 * Finds and reads [mcp_servers.apple-cua], refusing a layout it cannot edit safely (dotted keys, an inline table, a
 * split definition) rather than risk writing TOML Codex would reject.
 */
function readCodexTable(source: string, path: string): CodexTable {
	const lines = source === "" ? [] : source.split("\n");
	const tableLines = lines.flatMap((line, index) => (OUR_TABLE.test(line) ? [index] : []));
	if (tableLines.length > 1) {
		throw new Error(`${path} defines [mcp_servers.${SERVER_NAME}] more than once; fix it by hand`);
	}
	const start = tableLines[0] ?? -1;
	let end = start;
	if (start !== -1) {
		end = start + 1;
		while (end < lines.length && !(HEADER.test(lines[end] ?? "") && !OUR_SUBTABLE.test(lines[end] ?? ""))) {
			end += 1;
		}
		while (end > start + 1 && BLANK_OR_COMMENT.test(lines[end - 1] ?? "")) {
			end -= 1;
		}
	}
	lines.forEach((line, index) => {
		const inside = index >= start && index < end;
		if (!inside && (OUR_SUBTABLE.test(line) || OTHER_FORM.test(line))) {
			throw new Error(
				`${path} defines ${SERVER_NAME} in a form apple-cua does not edit (line ${index + 1}); update it by hand`,
			);
		}
	});

	const extras: string[] = [];
	const subtables: string[][] = [];
	let env: Record<string, string> = {};
	if (start === -1) {
		return { lines, start, end, before: undefined, env, extras, subtables };
	}
	let command: string | undefined;
	let args: string[] = [];
	let section: "main" | "env" | "other" = "main";
	let index = start + 1;
	while (index < end) {
		const line = lines[index] ?? "";
		const subtable = OUR_SUBTABLE.exec(line);
		if (subtable !== null) {
			section = (subtable[1] ?? "").replace(/\s+/g, "") === "env" ? "env" : "other";
			if (section === "other") {
				subtables.push([line]);
			}
			index += 1;
			continue;
		}
		if (section === "other") {
			subtables[subtables.length - 1]?.push(line);
			index += 1;
			continue;
		}
		if (section === "env") {
			if (!BLANK_OR_COMMENT.test(line)) {
				const pair = KEY_VALUE.exec(line);
				if (pair === null || pair[1] === undefined || pair[2] === undefined) {
					throw new Error(
						`cannot read [mcp_servers.${SERVER_NAME}.env] in ${path} (line ${index + 1}); edit it by hand`,
					);
				}
				env[parseTomlKey(pair[1])] = parseTomlString(pair[2]);
			}
			index += 1;
			continue;
		}
		if (/^\s*(?:env|"env")\s*\./.test(line)) {
			throw new Error(`${path} sets env of [mcp_servers.${SERVER_NAME}] with dotted keys; edit it by hand`);
		}
		const managed = /^\s*(command|args|env)\s*=\s*(.*)$/.exec(line);
		if (managed === null) {
			extras.push(line);
			index += 1;
			continue;
		}
		const span = valueLineCount(lines, index);
		const value = [managed[2] ?? "", ...lines.slice(index + 1, index + span)].join("\n");
		if (managed[1] === "command") {
			command = parseStringArray(value)[0];
		} else if (managed[1] === "args") {
			args = parseStringArray(value);
		} else {
			const body = /^\s*\{([\s\S]*)\}\s*(?:#.*)?$/.exec(value);
			if (body === null) {
				throw new Error(`cannot read the env value of [mcp_servers.${SERVER_NAME}] in ${path}; edit it by hand`);
			}
			env = { ...env, ...parseInlineTable(body[1] ?? "", path) };
		}
		index += span;
	}
	return { lines, start, end, before: { command, args, env }, env, extras, subtables };
}

/**
 * Rewrites only the [mcp_servers.apple-cua] table (in place, or appended) and keeps every other byte; a table that
 * already does what `desired` says is left alone.
 */
function mergeCodexToml(text: string | undefined, desired: DesiredRegistration, path = "config.toml"): FileEdit {
	const source = text ?? "";
	const table = readCodexTable(source, path);
	if (table.before !== undefined && entryIsCurrent(table.before, desired)) {
		return { text: source, changed: false, before: table.before };
	}
	const env = applyEnvUpdate(table.env, desired.env);
	const extras = [...table.extras];
	while (extras.length > 0 && extras[0]?.trim() === "") {
		extras.shift();
	}
	while (extras.length > 0 && extras[extras.length - 1]?.trim() === "") {
		extras.pop();
	}
	const block = [
		`[mcp_servers.${SERVER_NAME}]`,
		`command = ${JSON.stringify(desired.launch.command)}`,
		`args = [${desired.launch.args.map((argument) => JSON.stringify(argument)).join(", ")}]`,
		...extras,
	];
	const envEntries = Object.entries(env);
	if (envEntries.length > 0) {
		block.push("", `[mcp_servers.${SERVER_NAME}.env]`);
		for (const [key, value] of envEntries) {
			block.push(`${tomlKey(key)} = ${JSON.stringify(String(value))}`);
		}
	}
	for (const subtable of table.subtables) {
		const trimmed = [...subtable];
		while (trimmed.length > 1 && trimmed[trimmed.length - 1]?.trim() === "") {
			trimmed.pop();
		}
		block.push("", ...trimmed);
	}

	let nextLines: string[];
	if (table.start === -1) {
		const kept = [...table.lines];
		if (kept.length > 0 && kept[kept.length - 1] === "") {
			kept.pop();
		}
		nextLines = kept.length === 0 ? [...block, ""] : [...kept, "", ...block, ""];
	} else {
		nextLines = [...table.lines.slice(0, table.start), ...block, ...table.lines.slice(table.end)];
		if (nextLines[nextLines.length - 1] !== "") {
			nextLines.push("");
		}
	}
	const nextText = nextLines.join("\n");
	const after = mergeServerEntry({ env: table.env }, desired);
	return { text: nextText, changed: nextText !== source, before: table.before, after };
}

/** Removes [mcp_servers.apple-cua] and its sub-tables, and the blank line that separated them from the rest. */
function removeFromCodexToml(text: string | undefined, path = "config.toml"): FileEdit {
	const source = text ?? "";
	const table = readCodexTable(source, path);
	if (table.start === -1) {
		return { text: source, changed: false, before: undefined };
	}
	const head = table.lines.slice(0, table.start);
	const tail = table.lines.slice(table.end);
	while (head.length > 0 && head[head.length - 1]?.trim() === "" && (tail[0] ?? "").trim() === "") {
		head.pop();
	}
	if (head.length === 0) {
		while (tail.length > 1 && tail[0]?.trim() === "") {
			tail.shift();
		}
	}
	const nextLines = [...head, ...tail];
	const nextText = nextLines.every((line) => line.trim() === "") ? "" : nextLines.join("\n");
	return {
		text: nextText.endsWith("\n") || nextText === "" ? nextText : `${nextText}\n`,
		changed: true,
		before: table.before,
	};
}

// --- Files ---------------------------------------------------------------------------------------------------------

function timestamp(now: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function backupPathFor(path: string, now: Date): string {
	const base = `${path}.bak-${timestamp(now)}`;
	let candidate = base;
	for (let suffix = 2; existsSync(candidate); suffix += 1) {
		candidate = `${base}-${suffix}`;
	}
	return candidate;
}

/** Copies a file to <file>.bak-<timestamp> with its permissions and returns the copy's path. */
function backupFile(path: string, now: Date): string {
	const target = realpathSync(path);
	const backup = backupPathFor(target, now);
	copyFileSync(target, backup);
	chmodSync(backup, statSync(target).mode & 0o7777);
	return backup;
}

/**
 * Backs up an existing file, then replaces it atomically with its original permissions. A symlinked config is
 * written through to its target so the link survives.
 */
export function writeConfigFile(path: string, text: string, now: Date): { path: string; backup: string | undefined } {
	const target = existsSync(path) ? realpathSync(path) : path;
	let backup: string | undefined;
	let mode = 0o600;
	if (existsSync(target)) {
		mode = statSync(target).mode & 0o7777;
		backup = backupFile(target, now);
	} else {
		mkdirSync(dirname(target), { recursive: true });
	}
	const temporary = `${target}.tmp-${process.pid}`;
	writeFileSync(temporary, text, { mode });
	chmodSync(temporary, mode);
	renameSync(temporary, target);
	return { path: target, backup };
}

function readText(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function findExecutable(name: string, pathVariable: string | undefined): string | undefined {
	for (const directory of (pathVariable ?? "").split(delimiter)) {
		if (directory === "") {
			continue;
		}
		const candidate = join(directory, name);
		if (existsSync(candidate) && (statSync(candidate).mode & 0o111) !== 0) {
			return candidate;
		}
	}
	return undefined;
}

// --- Clients -------------------------------------------------------------------------------------------------------

function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value === "" ? undefined : value;
}

/** The file a client keeps its MCP servers in; undefined for json, which has no file. */
function clientConfigPath(client: ClientName, context: ClientContext): string | undefined {
	switch (client) {
		case "omo":
			return join(context.home, ".omo/agent/mcp.json");
		case "claude":
			return join(nonEmpty(context.env["CLAUDE_CONFIG_DIR"]) ?? context.home, ".claude.json");
		case "codex":
			return join(nonEmpty(context.env["CODEX_HOME"]) ?? join(context.home, ".codex"), "config.toml");
		case "cursor":
			return join(context.home, ".cursor/mcp.json");
		case "gemini":
			return join(context.home, ".gemini/settings.json");
		case "hermes":
			return join(hermesHomeOf(context.home, context.env), "config.yaml");
		case "openclaw":
			return openClawConfigPathOf(context.home, context.env);
		case "pi":
		case "json":
			return undefined;
	}
}

/** The apple-cua entry a client's configuration holds now; `error` when the file cannot be read. */
export function readClientEntry(
	client: ClientName,
	context: ClientContext,
): { path: string | undefined; entry: RegisteredEntry | undefined; error?: string | undefined } {
	const path = clientConfigPath(client, context);
	if (path === undefined) {
		return { path, entry: undefined };
	}
	const text = readText(path);
	if (text === undefined) {
		return { path, entry: undefined };
	}
	try {
		if (client === "codex") {
			return { path, entry: readCodexTable(text, path).before };
		}
		if (client === "hermes") {
			return { path, entry: readHermesEntry(text) };
		}
		if (client === "openclaw") {
			const parsed: unknown = JSON.parse(text);
			const mcp = isPlainObject(parsed) ? parsed["mcp"] : undefined;
			const servers = isPlainObject(mcp) ? mcp["servers"] : undefined;
			return { path, entry: toRegisteredEntry(isPlainObject(servers) ? servers[SERVER_NAME] : undefined) };
		}
		return { path, entry: toRegisteredEntry(parseJsonConfig(text).servers[SERVER_NAME]) };
	} catch (error) {
		return { path, entry: undefined, error: error instanceof Error ? error.message : String(error) };
	}
}

function staleDetail(entry: RegisteredEntry, desired: DesiredRegistration): string {
	if (entry.command !== desired.launch.command) {
		return `runs ${entry.command ?? "no command"} instead of ${desired.launch.command}`;
	}
	if (entry.args.join(" ") !== desired.launch.args.join(" ")) {
		return `passes ${entry.args.join(" ") || "no arguments"} instead of ${desired.launch.args.join(" ")}`;
	}
	return "its environment differs from the saved settings";
}

/** Whether a client's registration matches `desired`, read without changing anything. */
export function inspectClient(
	client: ClientName,
	desired: DesiredRegistration,
	context: ClientContext,
): ClientInspection {
	if (client === "json") {
		return { client, state: "manual", detail: "a printed block you pasted by hand; apple-cua cannot check it" };
	}
	if ((client === "codex" || client === "claude") && desired.bundle !== undefined) {
		const cli = pluginCli(client, context);
		if (cli !== undefined) {
			return inspectPlugin(client, desired.bundle, context);
		}
	}
	if (isAgentClient(client)) {
		return inspectAgent(client, desired, context);
	}
	const { path, entry, error } = readClientEntry(client, context);
	if (error !== undefined) {
		return { client, state: "unreadable", path, detail: error };
	}
	if (entry === undefined) {
		if (client === "claude" && findExecutable("claude", context.env["PATH"]) === undefined) {
			return {
				client,
				state: "manual",
				path,
				detail: "the claude CLI is not on PATH, so apple-cua printed a block to add to ~/.claude.json by hand",
			};
		}
		return { client, state: "missing", path, detail: `no ${SERVER_NAME} entry` };
	}
	if (entryIsCurrent(entry, desired)) {
		if (client === "omo" && entry.lifecycle === undefined) {
			return {
				client,
				state: "stale",
				path,
				entry,
				detail: "uses OmO's implicit idle shutdown instead of keeping the guarded session alive",
			};
		}
		if (client === "omo" && entry.requestTimeoutMs === undefined) {
			return {
				client,
				state: "stale",
				path,
				entry,
				detail: "uses OmO's short default request timeout for operations that can run for two minutes",
			};
		}
		return { client, state: "current", path, entry, detail: "registered, up to date" };
	}
	return { client, state: "stale", path, entry, detail: staleDetail(entry, desired) };
}

function registerJsonFile(
	client: "omo" | "cursor",
	desired: DesiredRegistration,
	context: ClientContext,
): ClientChange {
	const path = clientConfigPath(client, context) ?? "";
	const text = readText(path);
	let merged: FileEdit;
	try {
		merged = mergeJsonConfig(text, desired, client);
	} catch (error) {
		throw new Error(
			`${path} cannot be read as JSON (${error instanceof Error ? error.message : String(error)}); left it untouched`,
		);
	}
	if (!merged.changed) {
		return { client, action: "unchanged", path, before: merged.before };
	}
	const written = writeConfigFile(path, merged.text, context.now);
	return {
		client,
		action: merged.before === undefined ? "added" : "updated",
		path: written.path,
		backup: written.backup,
		before: merged.before,
		after: merged.after,
	};
}

function registerCodex(desired: DesiredRegistration, context: ClientContext): ClientChange {
	const path = clientConfigPath("codex", context) ?? "";
	const merged = mergeCodexToml(readText(path), desired, path);
	if (!merged.changed) {
		return { client: "codex", action: "unchanged", path, before: merged.before };
	}
	const written = writeConfigFile(path, merged.text, context.now);
	return {
		client: "codex",
		action: merged.before === undefined ? "added" : "updated",
		path: written.path,
		backup: written.backup,
		before: merged.before,
		after: merged.after,
	};
}

function runClaude(claude: string, args: readonly string[], context: ClientContext) {
	return spawnSync(claude, args, { encoding: "utf8", env: { ...context.env } });
}

function registerClaude(desired: DesiredRegistration, context: ClientContext): ClientChange {
	const path = clientConfigPath("claude", context) ?? "";
	let raw: unknown;
	const text = readText(path);
	if (text !== undefined) {
		try {
			raw = parseJsonConfig(text).servers[SERVER_NAME];
		} catch {
			raw = undefined;
		}
	}
	const before = toRegisteredEntry(raw);
	if (before !== undefined && entryIsCurrent(before, desired)) {
		return { client: "claude", action: "unchanged", path, before };
	}
	const after = mergeServerEntry(raw ?? { type: "stdio" }, desired);
	const claude = findExecutable("claude", context.env["PATH"]);
	if (claude === undefined) {
		return {
			client: "claude",
			action: "printed",
			printed: { mcpServers: { [SERVER_NAME]: after } },
			note: "the claude CLI is not on PATH; add this to the mcpServers of ~/.claude.json, or run `claude mcp add-json` with it",
		};
	}
	const backup = existsSync(path) ? backupFile(path, context.now) : undefined;
	if (before !== undefined) {
		runClaude(claude, ["mcp", "remove", SERVER_NAME, "--scope", "user"], context);
	}
	const envFlags = Object.entries(stringRecord(after["env"])).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
	const added = runClaude(
		claude,
		["mcp", "add", "--scope", "user", SERVER_NAME, ...envFlags, "--", desired.launch.command, ...desired.launch.args],
		context,
	);
	if (added.status !== 0) {
		throw new Error(
			`claude mcp add failed: ${(added.stderr || added.stdout || "").trim() || `exit ${added.status}`}`,
		);
	}
	return { client: "claude", action: before === undefined ? "added" : "updated", path, backup, before, after };
}

// --- Plugin clients (Codex, Claude Code) ------------------------------------------------------------------------

const RESTART: Readonly<Record<"codex" | "claude", string>> = {
	codex: "start a new Codex thread to pick it up",
	claude: "restart Claude Code to pick it up",
};

const pluginSupport = new Map<string, boolean>();

/** The client's CLI when it has the plugin commands; undefined means the plain MCP entry is used instead. */
function pluginCli(client: "codex" | "claude", context: ClientContext): string | undefined {
	const cli = findExecutable(client, context.env["PATH"]);
	if (cli === undefined) {
		return undefined;
	}
	const key = `${cli}\0${context.run === undefined ? "real" : "injected"}`;
	let supported = pluginSupport.get(key);
	if (supported === undefined) {
		supported = supportsPlugins(cli, context.env, context.run ?? runCli);
		if (context.run === undefined) {
			pluginSupport.set(key, supported);
		}
	}
	return supported ? cli : undefined;
}

/** Whether a client gets apple-cua as a plugin here: its CLI is installed and has the plugin commands. */
export function usesPlugin(client: "codex" | "claude", context: ClientContext): boolean {
	return pluginCli(client, context) !== undefined;
}

function removeLegacyEntry(client: "codex" | "claude", cli: string, context: ClientContext): void {
	if (client === "claude") {
		const result = (context.run ?? runCli)(cli, ["mcp", "remove", SERVER_NAME, "--scope", "user"], context.env);
		if (result.status !== 0) {
			throw new Error(
				`claude mcp remove failed: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}`,
			);
		}
		return;
	}
	const path = clientConfigPath("codex", context) ?? "";
	const edit = removeFromCodexToml(readText(path), path);
	if (edit.changed) {
		writeConfigFile(path, edit.text, context.now);
	}
}

function pluginState(client: "codex" | "claude", context: ClientContext) {
	const legacy = readClientEntry(client, context).entry;
	return client === "codex"
		? { client, state: readCodexState(context.home, context.env, legacy) }
		: { client, state: readClaudeState(context.home, context.env, legacy) };
}

function planPluginInstall(
	client: "codex" | "claude",
	target: PluginTarget,
	explicit: boolean,
	context: ClientContext,
): PluginPlan {
	const read = pluginState(client, context);
	return read.client === "codex"
		? planCodexInstall(read.state, target)
		: planClaudeInstall(read.state, target, explicit);
}

function registerPlugin(
	client: "codex" | "claude",
	cli: string,
	desired: DesiredRegistration & { readonly bundle: PluginTarget },
	context: ClientContext,
): ClientChange {
	const plan = planPluginInstall(client, desired.bundle, desired.explicit === true, context);
	if (plan.blocked !== undefined) {
		return { client, action: "manual", note: plan.blocked };
	}
	if (plan.outcome === "unchanged") {
		return { client, action: "unchanged", note: `plugin ${desired.bundle.version}` };
	}
	const steps = runSteps(plan, {
		cli,
		env: context.env,
		run: context.run ?? runCli,
		removeLegacy: () => removeLegacyEntry(client, cli, context),
	});
	return {
		client,
		action: plan.outcome === "added" ? "added" : "updated",
		note: `plugin ${desired.bundle.version}`,
		steps,
		restart: RESTART[client],
	};
}

function unregisterPlugin(
	client: "codex" | "claude",
	cli: string,
	checkout: string,
	context: ClientContext,
): ClientChange {
	const read = pluginState(client, context);
	const plan =
		read.client === "codex" ? planCodexRemove(read.state, checkout) : planClaudeRemove(read.state, checkout);
	if (plan.outcome === "absent") {
		return { client, action: "absent" };
	}
	const steps = runSteps(plan, {
		cli,
		env: context.env,
		run: context.run ?? runCli,
		removeLegacy: () => removeLegacyEntry(client, cli, context),
	});
	return { client, action: "removed", steps, restart: RESTART[client] };
}

function inspectPlugin(client: "codex" | "claude", target: PluginTarget, context: ClientContext): ClientInspection {
	const read = pluginState(client, context);
	const disabled = read.client === "codex" ? read.state.plugin?.enabled === false : read.state.enabled === false;
	const plan =
		read.client === "codex" ? planCodexInstall(read.state, target) : planClaudeInstall(read.state, target, false);
	if (plan.blocked !== undefined) {
		return { client, state: "conflict", detail: plan.blocked };
	}
	if (disabled) {
		return {
			client,
			state: "disabled",
			detail: `the apple-cua plugin is installed but switched off in ${client === "codex" ? "Codex" : "Claude Code"}`,
		};
	}
	if (plan.outcome === "added") {
		return { client, state: "missing", detail: "the apple-cua plugin is not installed" };
	}
	if (plan.outcome === "updated") {
		return { client, state: "stale", detail: `needs: ${plan.steps.map((step) => step.describe).join("; ")}` };
	}
	return { client, state: "current", detail: `plugin ${target.version}, up to date` };
}

// --- Agent CLI clients (Gemini CLI, Hermes Agent, OpenClaw, pi) -----------------------------------------------------

type AgentClient = "gemini" | "hermes" | "openclaw" | "pi";

function isAgentClient(client: ClientName): client is AgentClient {
	return client === "gemini" || client === "hermes" || client === "openclaw" || client === "pi";
}

const AGENT_RESTART: Readonly<Record<AgentClient, string>> = {
	gemini: "start a new Gemini CLI session to pick it up",
	hermes: "start a new Hermes session or run /reload-mcp (a running gateway picks it up within a minute)",
	openclaw: "running OpenClaw agents use it from their next turn; restart the gateway if one does not",
	pi: "start a new pi session to pick it up",
};

const AGENT_INSTALL_HINT: Readonly<Record<AgentClient, string>> = {
	gemini:
		"the gemini CLI is not on PATH; install Gemini CLI (npm install -g @google/gemini-cli), then run: apple-cua config --register gemini",
	hermes:
		"the hermes CLI is not installed (the Hermes app only sets it up); finish Hermes' setup (curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash), then run: apple-cua config --register hermes",
	openclaw:
		"the openclaw CLI is not installed; install it from the OpenClaw app (its command-line tool installer), then run: apple-cua config --register openclaw",
	pi: "the original pi (npm install -g @mariozechner/pi-coding-agent) is not on PATH; a `pi` that is senpi or OmO is registered as the omo client instead",
};

function existingFile(path: string): string | undefined {
	return existsSync(path) ? path : undefined;
}

/** The client's own CLI, found the way its installer puts it; undefined when it is not installed. */
export function agentCli(client: AgentClient, context: ClientContext): string | undefined {
	const path = context.env["PATH"];
	switch (client) {
		case "gemini":
			return findExecutable("gemini", path);
		case "hermes":
			return findExecutable("hermes", path) ?? existingFile(join(context.home, ".local/bin/hermes"));
		case "openclaw":
			return (
				findExecutable("openclaw", path) ??
				existingFile(
					join(nonEmpty(context.env["OPENCLAW_PREFIX"]) ?? join(context.home, ".openclaw"), "bin/openclaw"),
				)
			);
		case "pi": {
			const pi = findExecutable("pi", path);
			return pi !== undefined && isOriginalPi(pi) ? pi : undefined;
		}
	}
}

function planAgent(
	client: AgentClient,
	desired: DesiredRegistration,
	context: ClientContext,
	checkout: string,
): PluginPlan | undefined {
	switch (client) {
		case "gemini":
			return desired.bundle === undefined
				? undefined
				: planGeminiInstall(readGeminiState(context.home), desired.bundle.bundleDir, checkout);
		case "hermes":
			return planHermesInstall(readHermesState(context.home, context.env), desired, checkout);
		case "openclaw":
			return planOpenClawInstall(readOpenClawState(context.home, context.env), desired, checkout);
		case "pi":
			return planPiInstall(readPiState(context.home, context.env), checkout);
	}
}

function planAgentRemove(client: AgentClient, context: ClientContext, checkout: string): PluginPlan {
	switch (client) {
		case "gemini":
			return planGeminiRemove(readGeminiState(context.home), checkout);
		case "hermes":
			return planHermesRemove(readHermesState(context.home, context.env), checkout);
		case "openclaw":
			return planOpenClawRemove(readOpenClawState(context.home, context.env), checkout);
		case "pi":
			return planPiRemove(readPiState(context.home, context.env), checkout);
	}
}

function registerAgent(client: AgentClient, desired: DesiredRegistration, context: ClientContext): ClientChange {
	const cli = agentCli(client, context);
	if (cli === undefined) {
		return { client, action: "manual", note: AGENT_INSTALL_HINT[client] };
	}
	const checkout = desired.bundle?.checkout;
	const plan = checkout === undefined ? undefined : planAgent(client, desired, context, checkout);
	if (plan === undefined) {
		return { client, action: "manual", note: "run apple-cua config from the checkout's own apple-cua command" };
	}
	if (plan.blocked !== undefined) {
		return { client, action: "manual", note: plan.blocked };
	}
	if (plan.outcome === "unchanged") {
		return client === "gemini"
			? { client, action: "unchanged", note: "linked to the bundle, so it follows settings changes by itself" }
			: { client, action: "unchanged" };
	}
	const steps = runSteps(plan, { cli, env: context.env, run: context.run ?? runCli, removeLegacy: () => {} });
	return {
		client,
		action: plan.outcome === "added" ? "added" : "updated",
		note: "integration",
		steps,
		restart: AGENT_RESTART[client],
	};
}

function unregisterAgent(client: AgentClient, checkout: string | undefined, context: ClientContext): ClientChange {
	const cli = agentCli(client, context);
	if (cli === undefined || checkout === undefined) {
		return {
			client,
			action: "manual",
			note:
				cli === undefined
					? `the ${client} CLI is not installed, so apple-cua cannot remove its ${SERVER_NAME} entry; remove it by hand if one is left`
					: "run apple-cua uninstall from the checkout's own apple-cua command",
		};
	}
	const plan = planAgentRemove(client, context, checkout);
	if (plan.blocked !== undefined) {
		return { client, action: "manual", note: plan.blocked };
	}
	if (plan.outcome === "absent") {
		return { client, action: "absent" };
	}
	const steps = runSteps(plan, { cli, env: context.env, run: context.run ?? runCli, removeLegacy: () => {} });
	return { client, action: "removed", steps, restart: AGENT_RESTART[client] };
}

function inspectAgent(client: AgentClient, desired: DesiredRegistration, context: ClientContext): ClientInspection {
	if (agentCli(client, context) === undefined) {
		return { client, state: "manual", detail: AGENT_INSTALL_HINT[client] };
	}
	const checkout = desired.bundle?.checkout;
	const plan = checkout === undefined ? undefined : planAgent(client, desired, context, checkout);
	if (plan === undefined) {
		return { client, state: "manual", detail: "cannot be checked without the bundle" };
	}
	if (plan.blocked !== undefined) {
		return { client, state: "conflict", detail: plan.blocked };
	}
	if (plan.outcome === "added") {
		return { client, state: "missing", detail: `apple-cua is not set up in ${CLIENT_LABELS[client]}` };
	}
	if (plan.outcome === "updated") {
		return { client, state: "stale", detail: `needs: ${plan.steps.map((step) => step.describe).join("; ")}` };
	}
	const caveat =
		client === "gemini"
			? " (Gemini turns MCP servers off in folders you have not trusted: trust the folder, or set GEMINI_CLI_TRUST_WORKSPACE=true)"
			: client === "hermes" || client === "openclaw"
				? " (a gateway that runs as a background service still needs a logged-in Mac session to reach the screen)"
				: "";
	return { client, state: "current", detail: `set up, up to date${caveat}` };
}

/** Writes `desired` into one client's configuration (or prints it, for json). */
export function registerClient(client: ClientName, desired: DesiredRegistration, context: ClientContext): ClientChange {
	switch (client) {
		case "omo":
			return registerJsonFile(client, desired, context);
		case "cursor": {
			const change = registerJsonFile(client, desired, context);
			const cli = findExecutable("cursor-agent", context.env["PATH"]);
			if (cli === undefined || (change.action !== "added" && change.action !== "updated")) {
				return change;
			}
			// A new or changed server is not loaded until approved; one approval is enough for every project.
			const approved = (context.run ?? runCli)(cli, ["mcp", "enable", SERVER_NAME], context.env);
			return {
				...change,
				note:
					approved.status === 0
						? "approved in Cursor (cursor-agent mcp enable)"
						: `not approved yet: run cursor-agent mcp enable ${SERVER_NAME}`,
				restart: "start a new Cursor agent session to pick it up",
			};
		}
		case "gemini":
		case "hermes":
		case "openclaw":
		case "pi":
			return registerAgent(client, desired, context);
		case "claude":
		case "codex": {
			const cli = desired.bundle === undefined ? undefined : pluginCli(client, context);
			if (cli !== undefined && desired.bundle !== undefined) {
				return registerPlugin(client, cli, { ...desired, bundle: desired.bundle }, context);
			}
			return client === "claude" ? registerClaude(desired, context) : registerCodex(desired, context);
		}
		case "json":
			return {
				client,
				action: "printed",
				printed: { mcpServers: { [SERVER_NAME]: mergeServerEntry(undefined, desired) } },
				note: "paste this into your MCP client's configuration",
			};
	}
}

/**
 * Cursor records each approved server in ~/.cursor/projects/<project>/mcp-approvals.json as "<name>-<hash>". After the
 * server is gone those records are stale, so this installation's own are dropped; any other entry and any file that is
 * not the expected JSON list stays as it is.
 */
function dropCursorApprovals(home: string): number {
	const projects = join(home, ".cursor/projects");
	let dropped = 0;
	let entries: string[];
	try {
		entries = readdirSync(projects);
	} catch {
		return 0;
	}
	for (const project of entries) {
		const path = join(projects, project, "mcp-approvals.json");
		const text = readText(path);
		if (text === undefined) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			continue;
		}
		if (!Array.isArray(parsed)) {
			continue;
		}
		const kept = parsed.filter((item) => !(typeof item === "string" && item.startsWith(`${SERVER_NAME}-`)));
		if (kept.length !== parsed.length) {
			dropped += parsed.length - kept.length;
			const temporary = `${path}.tmp-${process.pid}`;
			writeFileSync(temporary, `${JSON.stringify(kept, null, 2)}\n`, { mode: statSync(path).mode & 0o7777 });
			renameSync(temporary, path);
		}
	}
	return dropped;
}

/** Removes the apple-cua entry from one client's configuration; other servers and settings stay. */
export function unregisterClient(client: ClientName, context: ClientContext, checkout?: string): ClientChange {
	if ((client === "codex" || client === "claude") && checkout !== undefined) {
		const cli = pluginCli(client, context);
		if (cli !== undefined) {
			return unregisterPlugin(client, cli, checkout, context);
		}
	}
	if (isAgentClient(client)) {
		return unregisterAgent(client, checkout, context);
	}
	const path = clientConfigPath(client, context);
	if (client === "json" || path === undefined) {
		return {
			client,
			action: "manual",
			note: `remove the "${SERVER_NAME}" block you pasted into other MCP clients by hand`,
		};
	}
	const text = readText(path);
	if (client === "claude") {
		const before = readClientEntry("claude", context).entry;
		if (before === undefined) {
			return { client, action: "absent", path };
		}
		const claude = findExecutable("claude", context.env["PATH"]);
		if (claude === undefined) {
			return {
				client,
				action: "manual",
				path,
				before,
				note: `the claude CLI is not on PATH; remove mcpServers["${SERVER_NAME}"] from ${path} by hand`,
			};
		}
		const backup = backupFile(path, context.now);
		const removed = runClaude(claude, ["mcp", "remove", SERVER_NAME, "--scope", "user"], context);
		if (removed.status !== 0) {
			throw new Error(
				`claude mcp remove failed: ${(removed.stderr || removed.stdout || "").trim() || `exit ${removed.status}`}`,
			);
		}
		return { client, action: "removed", path, backup, before };
	}
	let edit: FileEdit;
	try {
		edit = client === "codex" ? removeFromCodexToml(text, path) : removeFromJsonConfig(text);
	} catch (error) {
		throw new Error(
			`${path} cannot be edited (${error instanceof Error ? error.message : String(error)}); left it untouched`,
		);
	}
	if (!edit.changed) {
		return { client, action: "absent", path };
	}
	const written = writeConfigFile(path, edit.text, context.now);
	const approvals = client === "cursor" ? dropCursorApprovals(context.home) : 0;
	return {
		client,
		action: "removed",
		path: written.path,
		backup: written.backup,
		before: edit.before,
		...(approvals === 0 ? {} : { note: `dropped ${approvals} stale approval record(s) Cursor kept for it` }),
	};
}

function flatten(value: unknown, prefix = "", into: Record<string, string> = {}): Record<string, string> {
	if (isPlainObject(value)) {
		for (const [key, inner] of Object.entries(value)) {
			flatten(inner, prefix === "" ? key : `${prefix}.${key}`, into);
		}
	} else if (value !== undefined) {
		into[prefix] = JSON.stringify(value);
	}
	return into;
}

/** One client's change as lines for a person: what happened, the backup, and each value that changed. */
export function describeChange(change: ClientChange, showPath: (path: string) => string = (path) => path): string {
	const label = change.client.padEnd(9);
	const where = change.path === undefined ? "" : `${showPath(change.path)}: `;
	const backup = change.backup === undefined ? "" : ` (backup: ${showPath(change.backup)})`;
	switch (change.action) {
		case "printed":
			return `${label}${change.note ?? ""}:\n${JSON.stringify(change.printed, null, 2)}`;
		case "manual":
			return `${label}${change.note ?? ""}`;
		case "unchanged":
			return `${label}${where}already registered${change.note === undefined ? "" : ` (${change.note})`}, unchanged`;
		case "absent":
			return `${label}${where}not registered, nothing to remove`;
		case "removed":
			if (change.steps !== undefined) {
				return [`${label}removed apple-cua`, ...change.steps.map((step) => `           ${step}`)].join("\n");
			}
			return `${label}${where}removed ${SERVER_NAME}${backup}`;
		case "added":
		case "updated": {
			if (change.steps !== undefined) {
				return [
					`${label}${change.action === "added" ? "installed" : "updated"} the apple-cua ${change.note ?? "plugin"}`,
					...change.steps.map((step) => `           ${step}`),
					...(change.restart === undefined ? [] : [`           -> ${change.restart}`]),
				].join("\n");
			}
			const lines = [
				`${label}${where}${change.action} ${SERVER_NAME}${backup}${change.note === undefined ? "" : `; ${change.note}`}`,
			];
			const before = flatten(change.before === undefined ? {} : { ...change.before, env: { ...change.before.env } });
			const after = flatten(change.after ?? {});
			// command, then args, then the environment, then anything else, whatever order the file had them in.
			const rank = (key: string) => ["command", "args"].indexOf(key) + 1 || (key.startsWith("env.") ? 3 : 4);
			const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(
				(left, right) => rank(left) - rank(right),
			);
			for (const key of keys) {
				if (before[key] !== after[key] && !(key === "args" && before[key] === "[]" && after[key] === undefined)) {
					lines.push(`           ${key}: ${before[key] ?? "(none)"} -> ${after[key] ?? "(removed)"}`);
				}
			}
			return lines.join("\n");
		}
	}
}
