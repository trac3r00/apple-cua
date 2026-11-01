import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** How to start opencua-mcp: the command, its arguments and the server's environment. */
export interface ServerLaunch {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export interface LaunchFiles {
	readonly exists: (file: string) => boolean;
	readonly read: (file: string) => string;
}

const COMMAND_ENV = "OPENCUA_MCP_COMMAND";
const ARGS_ENV = "OPENCUA_MCP_ARGS";
const ENV_PREFIX = "OPENCUA_";
const SERVER_NAME = "opencua";
const NODE_FILES: LaunchFiles = { exists: existsSync, read: (file) => readFileSync(file, "utf8") };

export const DOCTOR_HINT = "Run `opencua doctor` to see what is missing and how to fix it.";

/**
 * Where the server comes from, first match wins:
 * 1. OPENCUA_MCP_COMMAND (with OPENCUA_MCP_ARGS, a JSON array), for a server installed elsewhere;
 * 2. the per-Mac bundle `opencua setup` writes, $OPENCUA_HOME/bundle/plugins/opencua/.mcp.json: its command,
 *    args and env, the same registration every other client runs;
 * 3. the signed helper and server.js built in the checkout this extension lives in.
 * The pi process's own OPENCUA_* variables are passed on top in every case. The helper is the launcher because
 * macOS charges Accessibility and Screen Recording to it, not to the terminal running pi.
 */
export function resolveServerLaunch(
	env: Environment,
	packageRoot: string,
	files: LaunchFiles = NODE_FILES,
): ServerLaunch {
	const own = openCuaVariables(env);
	const command = nonEmpty(env[COMMAND_ENV]);
	const args = nonEmpty(env[ARGS_ENV]);
	if (command !== undefined) {
		return { command, args: args === undefined ? [] : parseArgs(args), env: own };
	}
	if (args !== undefined) {
		throw new Error(
			`opencua: ${ARGS_ENV} is set without ${COMMAND_ENV}; set both to choose the server, or neither to use the installed one.`,
		);
	}
	const bundle = bundleRegistrationPath(env);
	if (files.exists(bundle)) {
		const registration = parseBundleRegistration(files.read(bundle), bundle);
		return { ...registration, env: { ...registration.env, ...own } };
	}
	const dist = path.resolve(packageRoot, "../mcp/dist");
	const helper = path.join(dist, "opencua-mcp.app/Contents/MacOS/opencua-mcp");
	const server = path.join(dist, "server.js");
	const missing = [helper, server].filter((file) => !files.exists(file));
	if (missing.length > 0) {
		throw new Error(
			`opencua: cannot find opencua-mcp: there is no ${bundle} and ${missing.join(" and ")} not found. ${DOCTOR_HINT} To run a server installed elsewhere, set ${COMMAND_ENV} and ${ARGS_ENV}.`,
		);
	}
	return { command: helper, args: [server], env: own };
}

/** $OPENCUA_HOME/bundle/plugins/opencua/.mcp.json, with OPENCUA_HOME defaulting to ~/.opencua as the CLI does. */
export function bundleRegistrationPath(env: Environment): string {
	const home = nonEmpty(env["HOME"]) ?? homedir();
	const openCuaHome = path.resolve(nonEmpty(env["OPENCUA_HOME"]) ?? path.join(home, ".opencua"));
	return path.join(openCuaHome, "bundle/plugins/opencua/.mcp.json");
}

/** The opencua entry of a bundle .mcp.json; a file that cannot be read that way is an error, never skipped. */
export function parseBundleRegistration(text: string, file: string): ServerLaunch {
	const invalid = (detail: string) =>
		new Error(`opencua: ${file} ${detail}. Run \`opencua setup\` to regenerate it, or \`opencua doctor\`.`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw invalid(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	const entry = recordAt(recordAt(parsed, "mcpServers"), SERVER_NAME);
	if (entry === undefined) {
		throw invalid(`has no mcpServers["${SERVER_NAME}"] entry`);
	}
	const command = entry["command"];
	if (typeof command !== "string" || command.trim() === "") {
		throw invalid(`has no command for ${SERVER_NAME}`);
	}
	const args = entry["args"] ?? [];
	if (!isStringList(args)) {
		throw invalid(`has args for ${SERVER_NAME} that are not a list of strings`);
	}
	const env = entry["env"] ?? {};
	const variables = typeof env === "object" && env !== null && !Array.isArray(env) ? Object.entries(env) : undefined;
	if (variables === undefined || !variables.every((pair): pair is [string, string] => typeof pair[1] === "string")) {
		throw invalid(`has an env for ${SERVER_NAME} that is not a map of strings`);
	}
	return { command, args, env: Object.fromEntries(variables) };
}

function openCuaVariables(env: Environment): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter(
			(pair): pair is [string, string] => pair[0].startsWith(ENV_PREFIX) && pair[1] !== undefined,
		),
	);
}

function parseArgs(value: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		parsed = undefined;
	}
	if (!isStringList(parsed)) {
		throw new Error(`opencua: ${ARGS_ENV} must be a JSON array of strings, for example ["/path/to/server.js"].`);
	}
	return parsed;
}

function recordAt(value: unknown, key: string): Readonly<Record<string, unknown>> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const child: unknown = Object.fromEntries(Object.entries(value))[key];
	return typeof child === "object" && child !== null && !Array.isArray(child)
		? Object.fromEntries(Object.entries(child))
		: undefined;
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value.trim() === "" ? undefined : value;
}
