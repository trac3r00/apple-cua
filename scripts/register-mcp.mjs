#!/usr/bin/env node
// Registers the apple-cua MCP server with MCP clients: the signed helper app of this checkout runs its
// packages/mcp/dist/server.js, so Screen Recording and Accessibility belong to "apple-cua MCP".
//
//   node scripts/register-mcp.mjs <omo|claude|codex|json>... [--allow <bundle ids>] [--delivery background|attended]
//                                 [--toolset lean|full]
//
//   omo     ~/.omo/agent/mcp.json            mcpServers["apple-cua"]
//   claude  `claude mcp add --scope user`    (prints the JSON block when the claude CLI is not installed)
//   codex   ~/.codex/config.toml             [mcp_servers.apple-cua]
//   json    prints a block to paste into any other client's configuration
//
// Config files are merged, never replaced: other servers and settings stay as they are, unknown keys of an existing
// apple-cua entry are kept, and an option that is not given keeps the entry's current value. A file that would change
// is first copied to <file>.bak-<timestamp>; a file that already says the same thing is not touched.

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
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_NAME = "apple-cua";
export const CLIENTS = ["omo", "claude", "codex", "json"];
const DELIVERY_MODES = ["background", "attended"];
const TOOLSETS = ["lean", "full"];
const ALLOW_ENV = "APPLE_CUA_ALLOWED_BUNDLE_IDS";
const DELIVERY_ENV = "APPLE_CUA_DELIVERY";
const TOOLSET_ENV = "APPLE_CUA_TOOLSET";

const USAGE = `usage: node scripts/register-mcp.mjs <omo|claude|codex|json>... [options]

  --allow <ids>         comma-separated bundle ids the server may observe and drive (APPLE_CUA_ALLOWED_BUNDLE_IDS)
  --delivery <mode>     background (default) or attended (APPLE_CUA_DELIVERY)
  --toolset <profile>   full (default) or lean (APPLE_CUA_TOOLSET)
  -h, --help            show this help

An option you leave out keeps the value an existing registration already has.`;

export function parseArguments(argv) {
	const options = { clients: [], help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const value = () => {
			const next = argv[index + 1];
			if (next === undefined) {
				throw new Error(`${argument} needs a value`);
			}
			index += 1;
			return next;
		};
		if (argument === "-h" || argument === "--help") {
			options.help = true;
		} else if (argument === "--allow") {
			options.allow = value();
		} else if (argument === "--delivery") {
			options.delivery = value();
			if (!DELIVERY_MODES.includes(options.delivery)) {
				throw new Error(`--delivery must be one of ${DELIVERY_MODES.join(", ")}`);
			}
		} else if (argument === "--toolset") {
			options.toolset = value();
			if (!TOOLSETS.includes(options.toolset)) {
				throw new Error(`--toolset must be one of ${TOOLSETS.join(", ")}`);
			}
		} else if (argument.startsWith("-")) {
			throw new Error(`unknown option ${argument}`);
		} else {
			for (const client of argument.split(",").filter((name) => name !== "")) {
				if (!CLIENTS.includes(client)) {
					throw new Error(`unknown client "${client}" (expected ${CLIENTS.join(", ")})`);
				}
				if (!options.clients.includes(client)) {
					options.clients.push(client);
				}
			}
		}
	}
	if (!options.help && options.clients.length === 0) {
		throw new Error(`name at least one client (${CLIENTS.join(", ")})`);
	}
	return options;
}

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBundleIds(value) {
	return value
		.split(",")
		.map((id) => id.trim())
		.filter((id) => id !== "")
		.join(",");
}

/** The entry's environment with only the options that were given applied on top. */
export function mergeEnv(existing, options) {
	const env = { ...(isPlainObject(existing) ? existing : {}) };
	if (options.allow !== undefined) {
		env[ALLOW_ENV] = normalizeBundleIds(options.allow);
	}
	if (options.delivery !== undefined) {
		env[DELIVERY_ENV] = options.delivery;
	}
	if (options.toolset !== undefined) {
		env[TOOLSET_ENV] = options.toolset;
	}
	return env;
}

/** This checkout's launch command on top of an existing entry, whose other keys (type, enabled, ...) are kept. */
export function mergeServerEntry(existing, launch, options) {
	const base = isPlainObject(existing) ? existing : {};
	const env = mergeEnv(base.env, options);
	const merged = { ...base, command: launch.command, args: [...launch.args], env };
	return Object.fromEntries(Object.entries(merged).filter(([key]) => key !== "env" || Object.keys(env).length > 0));
}

function sameValue(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function detectIndent(text) {
	const match = /^([ \t]+)\S/m.exec(text ?? "");
	return match?.[1] ?? "  ";
}

/** JSON configs keyed by mcpServers (omo, Claude Desktop style). Throws on a file it cannot parse. */
export function mergeJsonConfig(text, launch, options) {
	const config = text === undefined || text.trim() === "" ? {} : JSON.parse(text);
	if (!isPlainObject(config)) {
		throw new Error("the top level is not a JSON object");
	}
	const servers = config.mcpServers ?? {};
	if (!isPlainObject(servers)) {
		throw new Error("mcpServers is not an object");
	}
	const before = servers[SERVER_NAME];
	const after = mergeServerEntry(before, launch, options);
	const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: after } };
	return {
		text: `${JSON.stringify(next, null, detectIndent(text))}\n`,
		changed: !sameValue(config, next),
		before,
		after,
	};
}

// --- Codex TOML -------------------------------------------------------------------------------------------------

const NAME = `(?:${SERVER_NAME}|"${SERVER_NAME}"|'${SERVER_NAME}')`;
const OUR_TABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${NAME}\\s*\\]\\s*(?:#.*)?$`);
const OUR_SUBTABLE = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${NAME}\\s*\\.\\s*([^\\]]+?)\\s*\\]\\s*(?:#.*)?$`);
const OTHER_FORM = new RegExp(`^\\s*(?:mcp_servers\\s*\\.\\s*)?${NAME}\\s*(?:\\.|=)`);
const HEADER = /^\s*\[\[?[^[\]]+\]\]?\s*(?:#.*)?$/;
const BASIC_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
const LITERAL_STRING = String.raw`'[^']*'`;
const KEY = String.raw`[A-Za-z0-9_-]+|${BASIC_STRING}`;
const KEY_VALUE = new RegExp(`^\\s*(${KEY})\\s*=\\s*(${BASIC_STRING}|${LITERAL_STRING})\\s*(?:#.*)?$`);
const INLINE_PAIR = new RegExp(`\\s*(${KEY})\\s*=\\s*(${BASIC_STRING}|${LITERAL_STRING})\\s*(,|$)`, "y");

function tomlKey(key) {
	return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function parseTomlString(token) {
	return token.startsWith("'") ? token.slice(1, -1) : JSON.parse(token);
}

function parseTomlKey(token) {
	return token.startsWith('"') ? JSON.parse(token) : token;
}

function parseInlineTable(body, path) {
	const values = {};
	const inner = body.trim();
	INLINE_PAIR.lastIndex = 0;
	while (INLINE_PAIR.lastIndex < inner.length) {
		const start = INLINE_PAIR.lastIndex;
		const match = INLINE_PAIR.exec(inner);
		if (match === null || match.index !== start) {
			throw new Error(`cannot read the env table of [mcp_servers.${SERVER_NAME}] in ${path}; edit it by hand`);
		}
		values[parseTomlKey(match[1])] = parseTomlString(match[2]);
	}
	return values;
}

/** How many lines a value starting on line `index` spans (multi-line arrays, inline tables and strings). */
function valueLineCount(lines, index) {
	let depth = 0;
	let multiline = null;
	for (let cursor = index; cursor < lines.length; cursor += 1) {
		let text = lines[cursor];
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

function parseStringArray(text) {
	return [...text.matchAll(new RegExp(`${BASIC_STRING}|${LITERAL_STRING}`, "g"))].map((match) =>
		parseTomlString(match[0]),
	);
}

/**
 * Codex's ~/.codex/config.toml. Rewrites only the [mcp_servers.apple-cua] table (in place, or appended), keeps every
 * other byte, and refuses a layout it cannot edit safely (dotted keys, an inline table, a split definition) rather
 * than risk writing TOML Codex would reject.
 */
export function mergeCodexToml(text, launch, options, path = "config.toml") {
	const source = text ?? "";
	const lines = source === "" ? [] : source.split("\n");
	const tableLines = lines.flatMap((line, index) => (OUR_TABLE.test(line) ? [index] : []));
	if (tableLines.length > 1) {
		throw new Error(`${path} defines [mcp_servers.${SERVER_NAME}] more than once; fix it by hand`);
	}
	const start = tableLines[0] ?? -1;
	let end = start;
	if (start !== -1) {
		end = start + 1;
		while (end < lines.length && !(HEADER.test(lines[end]) && !OUR_SUBTABLE.test(lines[end]))) {
			end += 1;
		}
		while (end > start + 1 && /^\s*(?:#.*)?$/.test(lines[end - 1])) {
			end -= 1;
		}
	}
	lines.forEach((line, index) => {
		const inside = index >= start && index < end;
		if (!inside && (OUR_SUBTABLE.test(line) || OTHER_FORM.test(line))) {
			throw new Error(
				`${path} defines ${SERVER_NAME} in a form this script does not edit (line ${index + 1}); update it by hand`,
			);
		}
	});

	const extras = [];
	const subtables = [];
	let env = {};
	let before;
	if (start !== -1) {
		before = { command: undefined, args: undefined, env: undefined };
		let section = "main";
		let index = start + 1;
		while (index < end) {
			const line = lines[index];
			const subtable = OUR_SUBTABLE.exec(line);
			if (subtable !== null) {
				section = subtable[1].replace(/\s+/g, "") === "env" ? "env" : "other";
				if (section === "other") {
					subtables.push([line]);
				}
				index += 1;
				continue;
			}
			if (section === "other") {
				subtables[subtables.length - 1].push(line);
				index += 1;
				continue;
			}
			if (section === "env") {
				if (/^\s*(?:#.*)?$/.test(line)) {
					index += 1;
					continue;
				}
				const pair = KEY_VALUE.exec(line);
				if (pair === null) {
					throw new Error(
						`cannot read [mcp_servers.${SERVER_NAME}.env] in ${path} (line ${index + 1}); edit it by hand`,
					);
				}
				env[parseTomlKey(pair[1])] = parseTomlString(pair[2]);
				before.env = env;
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
			const value = [managed[2], ...lines.slice(index + 1, index + span)].join("\n");
			if (managed[1] === "command") {
				before.command = parseStringArray(value)[0];
			} else if (managed[1] === "args") {
				before.args = parseStringArray(value);
			} else {
				const body = /^\s*\{([\s\S]*)\}\s*(?:#.*)?$/.exec(value);
				if (body === null) {
					throw new Error(`cannot read the env value of [mcp_servers.${SERVER_NAME}] in ${path}; edit it by hand`);
				}
				env = { ...env, ...parseInlineTable(body[1], path) };
				before.env = env;
			}
			index += span;
		}
	}

	const after = mergeServerEntry({ env }, launch, options);
	while (extras.length > 0 && extras[0].trim() === "") {
		extras.shift();
	}
	while (extras.length > 0 && extras[extras.length - 1].trim() === "") {
		extras.pop();
	}
	const block = [
		`[mcp_servers.${SERVER_NAME}]`,
		`command = ${JSON.stringify(after.command)}`,
		`args = [${after.args.map((argument) => JSON.stringify(argument)).join(", ")}]`,
		...extras,
	];
	if (after.env !== undefined) {
		block.push("", `[mcp_servers.${SERVER_NAME}.env]`);
		for (const [key, value] of Object.entries(after.env)) {
			block.push(`${tomlKey(key)} = ${JSON.stringify(String(value))}`);
		}
	}
	for (const subtable of subtables) {
		const trimmed = [...subtable];
		while (trimmed.length > 1 && trimmed[trimmed.length - 1].trim() === "") {
			trimmed.pop();
		}
		block.push("", ...trimmed);
	}

	let nextLines;
	if (start === -1) {
		const kept = [...lines];
		if (kept.length > 0 && kept[kept.length - 1] === "") {
			kept.pop();
		}
		nextLines = kept.length === 0 ? [...block, ""] : [...kept, "", ...block, ""];
	} else {
		nextLines = [...lines.slice(0, start), ...block, ...lines.slice(end)];
		if (nextLines[nextLines.length - 1] !== "") {
			nextLines.push("");
		}
	}
	const nextText = nextLines.join("\n");
	return { text: nextText, changed: nextText !== source, before, after };
}

// --- Writing -----------------------------------------------------------------------------------------------------

function timestamp(now) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function backupPathFor(path, now) {
	const base = `${path}.bak-${timestamp(now)}`;
	let candidate = base;
	for (let suffix = 2; existsSync(candidate); suffix += 1) {
		candidate = `${base}-${suffix}`;
	}
	return candidate;
}

/**
 * Backs up an existing file, then replaces it atomically with its original permissions. A symlinked config is
 * written through to its target so the link survives.
 */
export function writeConfigFile(path, text, now = new Date()) {
	const target = existsSync(path) ? realpathSync(path) : path;
	let backup;
	let mode = 0o600;
	if (existsSync(target)) {
		mode = statSync(target).mode & 0o7777;
		backup = backupPathFor(target, now);
		copyFileSync(target, backup);
		chmodSync(backup, mode);
	} else {
		mkdirSync(dirname(target), { recursive: true });
	}
	const temporary = `${target}.tmp-${process.pid}`;
	writeFileSync(temporary, text, { mode });
	chmodSync(temporary, mode);
	renameSync(temporary, target);
	return { path: target, backup };
}

// --- Clients -----------------------------------------------------------------------------------------------------

function registerJsonFile(client, path, launch, options, context) {
	const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
	let merged;
	try {
		merged = mergeJsonConfig(text, launch, options);
	} catch (error) {
		throw new Error(`${path} cannot be read as JSON (${error.message}); left it untouched`);
	}
	if (text !== undefined && !merged.changed) {
		return { client, path, changed: false, before: merged.before, after: merged.after };
	}
	const written = writeConfigFile(path, merged.text, context.now);
	return {
		client,
		path: written.path,
		backup: written.backup,
		changed: true,
		before: merged.before,
		after: merged.after,
	};
}

function findExecutable(name, pathVariable) {
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

function claudeConfigPath(context) {
	const configured = context.env.CLAUDE_CONFIG_DIR;
	return join(configured !== undefined && configured !== "" ? configured : context.home, ".claude.json");
}

function registerClaude(launch, options, context) {
	const path = claudeConfigPath(context);
	let before;
	if (existsSync(path)) {
		try {
			before = JSON.parse(readFileSync(path, "utf8"))?.mcpServers?.[SERVER_NAME];
		} catch {
			before = undefined;
		}
	}
	const after = mergeServerEntry(before ?? { type: "stdio" }, launch, options);
	const claude = findExecutable("claude", context.env.PATH);
	if (claude === undefined) {
		return {
			client: "claude",
			changed: false,
			printed: { mcpServers: { [SERVER_NAME]: after } },
			note: "the claude CLI is not on PATH; add this to the mcpServers of ~/.claude.json, or run `claude mcp add-json` with it",
		};
	}
	if (before !== undefined && sameValue(before, after)) {
		return { client: "claude", path, changed: false, before, after };
	}
	const backup = existsSync(path) ? writeBackupOnly(path, context.now) : undefined;
	const run = (args) => spawnSync(claude, args, { encoding: "utf8", env: context.env });
	if (before !== undefined) {
		run(["mcp", "remove", SERVER_NAME, "--scope", "user"]);
	}
	const envFlags = Object.entries(after.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
	const added = run(["mcp", "add", "--scope", "user", SERVER_NAME, ...envFlags, "--", after.command, ...after.args]);
	if (added.status !== 0) {
		throw new Error(
			`claude mcp add failed: ${(added.stderr || added.stdout || "").trim() || `exit ${added.status}`}`,
		);
	}
	return { client: "claude", path, backup, changed: true, before, after };
}

function writeBackupOnly(path, now) {
	const target = realpathSync(path);
	const backup = backupPathFor(target, now);
	copyFileSync(target, backup);
	chmodSync(backup, statSync(target).mode & 0o7777);
	return backup;
}

function registerCodex(launch, options, context) {
	const codexHome = context.env.CODEX_HOME;
	const path = join(
		codexHome !== undefined && codexHome !== "" ? codexHome : join(context.home, ".codex"),
		"config.toml",
	);
	const text = existsSync(path) ? readFileSync(path, "utf8") : "";
	const merged = mergeCodexToml(text, launch, options, path);
	if (!merged.changed) {
		return { client: "codex", path, changed: false, before: merged.before, after: merged.after };
	}
	const written = writeConfigFile(path, merged.text, context.now);
	return {
		client: "codex",
		path: written.path,
		backup: written.backup,
		changed: true,
		before: merged.before,
		after: merged.after,
	};
}

/** Registers with one client; `context` carries home, env and now so tests can point everything at a temp dir. */
export function registerClient(client, launch, options, context) {
	switch (client) {
		case "omo":
			return registerJsonFile("omo", join(context.home, ".omo/agent/mcp.json"), launch, options, context);
		case "claude":
			return registerClaude(launch, options, context);
		case "codex":
			return registerCodex(launch, options, context);
		case "json":
			return {
				client: "json",
				changed: false,
				printed: { mcpServers: { [SERVER_NAME]: mergeServerEntry(undefined, launch, options) } },
				note: "paste this into your MCP client's configuration",
			};
		default:
			throw new Error(`unknown client "${client}"`);
	}
}

function flatten(value, prefix = "", into = {}) {
	if (isPlainObject(value)) {
		for (const [key, inner] of Object.entries(value)) {
			flatten(inner, prefix === "" ? key : `${prefix}.${key}`, into);
		}
	} else if (value !== undefined) {
		into[prefix] = JSON.stringify(value);
	}
	return into;
}

export function describeResult(result) {
	const label = result.client.padEnd(7);
	if (result.printed !== undefined) {
		return `${label}${result.note}:\n${JSON.stringify(result.printed, null, 2)}`;
	}
	if (!result.changed) {
		return `${label}${result.path}: already registered, unchanged`;
	}
	const lines = [
		`${label}${result.path}: ${result.before === undefined ? "added" : "updated"} ${SERVER_NAME}${result.backup === undefined ? "" : ` (backup: ${result.backup})`}`,
	];
	const before = flatten(result.before ?? {});
	const after = flatten(result.after ?? {});
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (before[key] !== after[key]) {
			lines.push(`         ${key}: ${before[key] ?? "(none)"} -> ${after[key] ?? "(removed)"}`);
		}
	}
	return lines.join("\n");
}

export function launchForCheckout(repo) {
	return {
		command: join(repo, "packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp"),
		args: [join(repo, "packages/mcp/dist/server.js")],
	};
}

export function main(argv = process.argv.slice(2), env = process.env) {
	let options;
	try {
		options = parseArguments(argv);
	} catch (error) {
		process.stderr.write(`${error.message}\n\n${USAGE}\n`);
		return 2;
	}
	if (options.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
	const launch = launchForCheckout(repo);
	if (!existsSync(launch.command) || !existsSync(launch.args[0])) {
		process.stderr.write(`the helper app or server.js is missing under ${repo}; run ./scripts/setup.sh first\n`);
		return 1;
	}
	const context = { home: env.HOME !== undefined && env.HOME !== "" ? env.HOME : homedir(), env, now: new Date() };
	let failed = false;
	let approved = true;
	for (const client of options.clients) {
		try {
			const result = registerClient(client, launch, options, context);
			process.stdout.write(`${describeResult(result)}\n`);
			const entry = result.after ?? result.printed?.mcpServers?.[SERVER_NAME];
			if ((entry?.env?.[ALLOW_ENV] ?? "") === "") {
				approved = false;
			}
		} catch (error) {
			failed = true;
			process.stderr.write(`${client.padEnd(7)}failed: ${error.message}\n`);
		}
	}
	if (!approved) {
		process.stdout.write(
			"note: no app is approved yet, so the server can list apps but not observe or drive them; re-run with --allow com.apple.TextEdit,... to approve some\n",
		);
	}
	return failed ? 1 : 0;
}

function isEntryPoint() {
	try {
		return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

if (isEntryPoint()) {
	process.exitCode = main();
}
