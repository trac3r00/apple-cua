import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type LaunchFiles, bundleRegistrationPath, resolveServerLaunch } from "./launcher.js";

const PACKAGE_ROOT = "/checkout/packages/pi-extension";
const HELPER = "/checkout/packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp";
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
	return JSON.stringify({ mcpServers: { "apple-cua": entry } });
}

describe("#given APPLE_CUA_MCP_COMMAND #when the launch is resolved #then the override wins over bundle and checkout", () => {
	it("runs the command with the JSON args and only the pi process's APPLE_CUA_* variables", () => {
		const env = {
			HOME: "/Users/someone",
			PATH: "/usr/bin",
			APPLE_CUA_MCP_COMMAND: "/opt/node",
			APPLE_CUA_MCP_ARGS: '["/srv/server.js","--flag"]',
			APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
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
				APPLE_CUA_MCP_COMMAND: "/opt/node",
				APPLE_CUA_MCP_ARGS: '["/srv/server.js","--flag"]',
				APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
			},
		});
	});

	it.each(['"/srv/server.js"', "[1]", "not json"])("refuses APPLE_CUA_MCP_ARGS %s", (args) => {
		expect(() =>
			resolveServerLaunch(
				{ APPLE_CUA_MCP_COMMAND: "/opt/node", APPLE_CUA_MCP_ARGS: args },
				PACKAGE_ROOT,
				filesWith([]),
			),
		).toThrow(/APPLE_CUA_MCP_ARGS must be a JSON array of strings/);
	});

	it("refuses APPLE_CUA_MCP_ARGS without a command instead of guessing which server it belongs to", () => {
		expect(() =>
			resolveServerLaunch({ APPLE_CUA_MCP_ARGS: "[]" }, PACKAGE_ROOT, filesWith([HELPER, SERVER])),
		).toThrow(/APPLE_CUA_MCP_ARGS is set without APPLE_CUA_MCP_COMMAND/);
	});
});

describe("#given the bundle apple-cua setup writes #when the launch is resolved #then its registration is used", () => {
	let appleCuaHome: string | undefined;

	afterEach(() => {
		if (appleCuaHome !== undefined) {
			rmSync(appleCuaHome, { recursive: true, force: true });
			appleCuaHome = undefined;
		}
	});

	it("runs the bundle's command, args and env, with the pi process's APPLE_CUA_* variables on top", () => {
		appleCuaHome = mkdtempSync(path.join(tmpdir(), "apple-cua-pi-"));
		const registration = path.join(appleCuaHome, "bundle/plugins/apple-cua/.mcp.json");
		mkdirSync(path.dirname(registration), { recursive: true });
		writeFileSync(
			registration,
			bundleJson({
				command: "/Users/someone/apple-cua/packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp",
				args: ["/Users/someone/apple-cua/packages/mcp/dist/server.js"],
				env: {
					APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit,com.apple.Notes",
					APPLE_CUA_DELIVERY: "background",
					APPLE_CUA_TOOLSET: "full",
				},
			}),
		);

		const launch = resolveServerLaunch(
			{ APPLE_CUA_HOME: appleCuaHome, APPLE_CUA_DELIVERY: "attended", PATH: "/usr/bin", SECRET_TOKEN: "x" },
			PACKAGE_ROOT,
		);

		expect(launch).toEqual({
			command: "/Users/someone/apple-cua/packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp",
			args: ["/Users/someone/apple-cua/packages/mcp/dist/server.js"],
			env: {
				APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit,com.apple.Notes",
				APPLE_CUA_DELIVERY: "attended",
				APPLE_CUA_TOOLSET: "full",
				APPLE_CUA_HOME: appleCuaHome,
			},
		});
	});

	it("defaults APPLE_CUA_HOME to ~/.apple-cua like the CLI", () => {
		expect(bundleRegistrationPath({ HOME: "/Users/someone" })).toBe(
			"/Users/someone/.apple-cua/bundle/plugins/apple-cua/.mcp.json",
		);
	});

	it.each([
		["invalid JSON", "{", /is not valid JSON/],
		["no apple-cua entry", JSON.stringify({ mcpServers: {} }), /has no mcpServers\["apple-cua"\] entry/],
		["no command", bundleJson({ args: [] }), /has no command/],
		["non-string args", bundleJson({ command: "/helper", args: [1] }), /args .* not a list of strings/],
		[
			"non-string env",
			bundleJson({ command: "/helper", env: { APPLE_CUA_IPHONE: 1 } }),
			/env .* not a map of strings/,
		],
	])("refuses a bundle with %s rather than dropping the saved settings", (_label, text, message) => {
		const env = { HOME: "/Users/someone" };
		const bundle = bundleRegistrationPath(env);

		expect(() => resolveServerLaunch(env, PACKAGE_ROOT, filesWith([HELPER, SERVER], { [bundle]: text }))).toThrow(
			message,
		);
		expect(() => resolveServerLaunch(env, PACKAGE_ROOT, filesWith([HELPER, SERVER], { [bundle]: text }))).toThrow(
			/apple-cua doctor/,
		);
	});
});

describe("#given no override and no bundle #when the launch is resolved #then the checkout's helper runs server.js", () => {
	it("starts the signed helper with the server built next to this package", () => {
		const launch = resolveServerLaunch(
			{ HOME: "/Users/someone", APPLE_CUA_IPHONE: "1" },
			PACKAGE_ROOT,
			filesWith([HELPER, SERVER]),
		);

		expect(launch).toEqual({ command: HELPER, args: [SERVER], env: { APPLE_CUA_IPHONE: "1" } });
	});

	it("fails with an error naming apple-cua doctor when the helper is not built", () => {
		expect(() => resolveServerLaunch({ HOME: "/Users/someone" }, PACKAGE_ROOT, filesWith([SERVER]))).toThrow(
			/apple-cua-mcp\.app\/Contents\/MacOS\/apple-cua-mcp not found\. Run `apple-cua doctor`/,
		);
	});
});
