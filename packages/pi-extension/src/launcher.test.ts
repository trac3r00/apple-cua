import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type LaunchFiles, bundleRegistrationPath, resolveServerLaunch } from "./launcher.js";

const PACKAGE_ROOT = "/checkout/packages/pi-extension";
const HELPER = "/checkout/packages/mcp/dist/opencua-mcp.app/Contents/MacOS/opencua-mcp";
const SERVER = "/checkout/packages/mcp/dist/server.js";

function filesWith(existing: readonly string[], contents: Readonly<Record<string, string>> = {}): LaunchFiles {
	return {
		exists: (file) => existing.includes(file) || file in contents,
		read: (file) => {
			const text = contents[file];
			if (text === undefined) {
				throw new Error(`unexpected read of ${file}`);
			}
			return text;
		},
	};
}

function bundleJson(entry: unknown): string {
	return JSON.stringify({ mcpServers: { opencua: entry } });
}

describe("#given OPENCUA_MCP_COMMAND #when the launch is resolved #then the override wins over bundle and checkout", () => {
	it("runs the command with the JSON args and only the pi process's OPENCUA_* variables", () => {
		const env = {
			HOME: "/Users/someone",
			PATH: "/usr/bin",
			OPENCUA_MCP_COMMAND: "/opt/node",
			OPENCUA_MCP_ARGS: '["/srv/server.js","--flag"]',
			OPENCUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
		};
		const bundle = bundleRegistrationPath(env);

		const launch = resolveServerLaunch(
			env,
			PACKAGE_ROOT,
			filesWith([HELPER, SERVER], { [bundle]: bundleJson({ command: "/bundle/helper", args: [] }) }),
		);

		expect(launch).toEqual({
			command: "/opt/node",
			args: ["/srv/server.js", "--flag"],
			env: {
				OPENCUA_MCP_COMMAND: "/opt/node",
				OPENCUA_MCP_ARGS: '["/srv/server.js","--flag"]',
				OPENCUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
			},
		});
	});

	it.each(['"/srv/server.js"', "[1]", "not json"])("refuses OPENCUA_MCP_ARGS %s", (args) => {
		expect(() =>
			resolveServerLaunch({ OPENCUA_MCP_COMMAND: "/opt/node", OPENCUA_MCP_ARGS: args }, PACKAGE_ROOT, filesWith([])),
		).toThrow(/OPENCUA_MCP_ARGS must be a JSON array of strings/);
	});

	it("refuses OPENCUA_MCP_ARGS without a command instead of guessing which server it belongs to", () => {
		expect(() => resolveServerLaunch({ OPENCUA_MCP_ARGS: "[]" }, PACKAGE_ROOT, filesWith([HELPER, SERVER]))).toThrow(
			/OPENCUA_MCP_ARGS is set without OPENCUA_MCP_COMMAND/,
		);
	});
});

describe("#given the bundle opencua setup writes #when the launch is resolved #then its registration is used", () => {
	let openCuaHome: string | undefined;

	afterEach(() => {
		if (openCuaHome !== undefined) {
			rmSync(openCuaHome, { recursive: true, force: true });
			openCuaHome = undefined;
		}
	});

	it("runs the bundle's command, args and env, with the pi process's OPENCUA_* variables on top", () => {
		openCuaHome = mkdtempSync(path.join(tmpdir(), "opencua-pi-"));
		const registration = path.join(openCuaHome, "bundle/plugins/opencua/.mcp.json");
		mkdirSync(path.dirname(registration), { recursive: true });
		writeFileSync(
			registration,
			bundleJson({
				command: "/Users/someone/opencua/packages/mcp/dist/opencua-mcp.app/Contents/MacOS/opencua-mcp",
				args: ["/Users/someone/opencua/packages/mcp/dist/server.js"],
				env: {
					OPENCUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit,com.apple.Notes",
					OPENCUA_DELIVERY: "background",
					OPENCUA_TOOLSET: "full",
				},
			}),
		);

		const launch = resolveServerLaunch(
			{ OPENCUA_HOME: openCuaHome, OPENCUA_DELIVERY: "attended", PATH: "/usr/bin", SECRET_TOKEN: "x" },
			PACKAGE_ROOT,
		);

		expect(launch).toEqual({
			command: "/Users/someone/opencua/packages/mcp/dist/opencua-mcp.app/Contents/MacOS/opencua-mcp",
			args: ["/Users/someone/opencua/packages/mcp/dist/server.js"],
			env: {
				OPENCUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit,com.apple.Notes",
				OPENCUA_DELIVERY: "attended",
				OPENCUA_TOOLSET: "full",
				OPENCUA_HOME: openCuaHome,
			},
		});
	});

	it("defaults OPENCUA_HOME to ~/.opencua like the CLI", () => {
		expect(bundleRegistrationPath({ HOME: "/Users/someone" })).toBe(
			"/Users/someone/.opencua/bundle/plugins/opencua/.mcp.json",
		);
	});

	it.each([
		["invalid JSON", "{", /is not valid JSON/],
		["no opencua entry", JSON.stringify({ mcpServers: {} }), /has no mcpServers\["opencua"\] entry/],
		["no command", bundleJson({ args: [] }), /has no command/],
		["non-string args", bundleJson({ command: "/helper", args: [1] }), /args .* not a list of strings/],
		["non-string env", bundleJson({ command: "/helper", env: { OPENCUA_IPHONE: 1 } }), /env .* not a map of strings/],
	])("refuses a bundle with %s rather than dropping the saved settings", (_label, text, message) => {
		const env = { HOME: "/Users/someone" };
		const bundle = bundleRegistrationPath(env);

		expect(() => resolveServerLaunch(env, PACKAGE_ROOT, filesWith([HELPER, SERVER], { [bundle]: text }))).toThrow(
			message,
		);
		expect(() => resolveServerLaunch(env, PACKAGE_ROOT, filesWith([HELPER, SERVER], { [bundle]: text }))).toThrow(
			/opencua doctor/,
		);
	});
});

describe("#given no override and no bundle #when the launch is resolved #then the checkout's helper runs server.js", () => {
	it("starts the signed helper with the server built next to this package", () => {
		const launch = resolveServerLaunch(
			{ HOME: "/Users/someone", OPENCUA_IPHONE: "1" },
			PACKAGE_ROOT,
			filesWith([HELPER, SERVER]),
		);

		expect(launch).toEqual({ command: HELPER, args: [SERVER], env: { OPENCUA_IPHONE: "1" } });
	});

	it("fails with an error naming opencua doctor when the helper is not built", () => {
		expect(() => resolveServerLaunch({ HOME: "/Users/someone" }, PACKAGE_ROOT, filesWith([SERVER]))).toThrow(
			/opencua-mcp\.app\/Contents\/MacOS\/opencua-mcp not found\. Run `opencua doctor`/,
		);
	});
});
