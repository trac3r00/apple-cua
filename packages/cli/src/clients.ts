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
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { canonicalPath, isInside } from "./layout.js";

const SERVER_NAME = "apple-cua";
export const CLIENT_NAMES = ["omo", "claude", "codex", "json"] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];

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
}

export interface ClientContext {
	readonly home: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly now: Date;
}

/** An apple-cua entry as a client configuration holds it. */
export interface RegisteredEntry {
	readonly command: string | undefined;
	readonly args: readonly string[];
	readonly env: EnvMap;
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
}

export type RegistrationState = "current" | "stale" | "missing" | "unreadable" | "manual";

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
	return {
		command: typeof command === "string" ? command : undefined,
		args: Array.isArray(args) ? args.filter((argument): argument is string => typeof argument === "string") : [],
		env: stringRecord(value["env"]),
	};
}

function entryIsCurrent(entry: RegisteredEntry, desired: DesiredRegistration): boolean {
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

function mergeJsonConfig(text: string | undefined, desired: DesiredRegistration): FileEdit {
	const { config, servers } = parseJsonConfig(text);
	const before = toRegisteredEntry(servers[SERVER_NAME]);
	if (text !== undefined && before !== undefined && entryIsCurrent(before, desired)) {
		return { text, changed: false, before };
	}
	const after = mergeServerEntry(servers[SERVER_NAME], desired);
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

function findExecutable(name: string, pathVariable: string | undefined): string | undefined {
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
		return { client, state: "current", path, entry, detail: "registered, up to date" };
	}
	return { client, state: "stale", path, entry, detail: staleDetail(entry, desired) };
}

function registerJsonFile(client: "omo", desired: DesiredRegistration, context: ClientContext): ClientChange {
	const path = clientConfigPath(client, context) ?? "";
	const text = readText(path);
	let merged: FileEdit;
	try {
		merged = mergeJsonConfig(text, desired);
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

/** Writes `desired` into one client's configuration (or prints it, for json). */
export function registerClient(client: ClientName, desired: DesiredRegistration, context: ClientContext): ClientChange {
	switch (client) {
		case "omo":
			return registerJsonFile("omo", desired, context);
		case "claude":
			return registerClaude(desired, context);
		case "codex":
			return registerCodex(desired, context);
		case "json":
			return {
				client,
				action: "printed",
				printed: { mcpServers: { [SERVER_NAME]: mergeServerEntry(undefined, desired) } },
				note: "paste this into your MCP client's configuration",
			};
	}
}

/** Removes the apple-cua entry from one client's configuration; other servers and settings stay. */
export function unregisterClient(client: ClientName, context: ClientContext): ClientChange {
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
	return { client, action: "removed", path: written.path, backup: written.backup, before: edit.before };
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
	const label = change.client.padEnd(7);
	const where = change.path === undefined ? "" : `${showPath(change.path)}: `;
	const backup = change.backup === undefined ? "" : ` (backup: ${showPath(change.backup)})`;
	switch (change.action) {
		case "printed":
			return `${label}${change.note ?? ""}:\n${JSON.stringify(change.printed, null, 2)}`;
		case "manual":
			return `${label}${change.note ?? ""}`;
		case "unchanged":
			return `${label}${where}already registered, unchanged`;
		case "absent":
			return `${label}${where}not registered, nothing to remove`;
		case "removed":
			return `${label}${where}removed ${SERVER_NAME}${backup}`;
		case "added":
		case "updated": {
			const lines = [`${label}${where}${change.action} ${SERVER_NAME}${backup}`];
			const before = flatten(change.before === undefined ? {} : { ...change.before, env: { ...change.before.env } });
			const after = flatten(change.after ?? {});
			// command, then args, then the environment, then anything else, whatever order the file had them in.
			const rank = (key: string) => ["command", "args"].indexOf(key) + 1 || (key.startsWith("env.") ? 3 : 4);
			const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(
				(left, right) => rank(left) - rank(right),
			);
			for (const key of keys) {
				if (before[key] !== after[key] && !(key === "args" && before[key] === "[]" && after[key] === undefined)) {
					lines.push(`         ${key}: ${before[key] ?? "(none)"} -> ${after[key] ?? "(removed)"}`);
				}
			}
			return lines.join("\n");
		}
	}
}
