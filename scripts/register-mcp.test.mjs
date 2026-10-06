import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArguments, registerClient } from "./register-mcp.mjs";

const LAUNCH = {
	command: "/checkout/packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp",
	args: ["/checkout/packages/mcp/dist/server.js"],
};
const NOW = new Date(2026, 9, 6, 12, 0, 0);

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "register-mcp-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function context(env = {}, now = NOW) {
	return { home, env: { PATH: "", ...env }, now };
}

function backupsOf(path) {
	return readdirSync(dirname(path)).filter((entry) => entry.startsWith(`${basename(path)}.bak-`));
}

function writeConfig(path, text) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, { mode: 0o600 });
}

describe("#given register-mcp arguments #when they are parsed #then clients and managed values are validated", () => {
	it("accepts repeated and comma-joined clients with their options", () => {
		expect(parseArguments(["omo,codex", "omo"])).toMatchObject({ clients: ["omo", "codex"] });
		expect(
			parseArguments([
				"claude",
				"json",
				"--allow",
				"com.apple.TextEdit",
				"--delivery",
				"attended",
				"--toolset",
				"lean",
			]),
		).toMatchObject({
			clients: ["claude", "json"],
			allow: "com.apple.TextEdit",
			delivery: "attended",
			toolset: "lean",
		});
	});

	it("rejects an unknown client, a bad value and a missing value", () => {
		expect(() => parseArguments(["cursor"])).toThrow(/unknown client/);
		expect(() => parseArguments(["omo", "--delivery", "loud"])).toThrow(/--delivery/);
		expect(() => parseArguments(["omo", "--allow"])).toThrow(/needs a value/);
		expect(() => parseArguments([])).toThrow(/at least one client/);
	});
});

describe("#given an omo config with other servers #when apple-cua is registered #then it is merged, backed up and idempotent", () => {
	it("adds the entry, keeps every other server and setting, and backs up the original with its permissions", () => {
		const path = join(home, ".omo/agent/mcp.json");
		const original = {
			mcpServers: {
				codegraph: { command: "codegraph", args: ["serve", "--mcp"] },
				remote: { type: "http", url: "http://127.0.0.1:1/mcp", enabled: true },
			},
			other: { keep: true },
		};
		writeConfig(path, `${JSON.stringify(original, null, 2)}\n`);

		const result = registerClient("omo", LAUNCH, { allow: "com.apple.TextEdit, com.apple.finder" }, context());

		const written = JSON.parse(readFileSync(path, "utf8"));
		expect(written.mcpServers.codegraph).toEqual(original.mcpServers.codegraph);
		expect(written.mcpServers.remote).toEqual(original.mcpServers.remote);
		expect(written.other).toEqual({ keep: true });
		expect(written.mcpServers["apple-cua"]).toEqual({
			command: LAUNCH.command,
			args: LAUNCH.args,
			env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit,com.apple.finder" },
		});
		expect(result.changed).toBe(true);
		expect(JSON.parse(readFileSync(result.backup, "utf8"))).toEqual(original);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(result.backup).mode & 0o777).toBe(0o600);
	});

	it("writes nothing and adds no backup when the same registration runs again", () => {
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(path, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
		registerClient("omo", LAUNCH, { allow: "com.apple.TextEdit" }, context());
		const afterFirst = readFileSync(path, "utf8");
		const backupsAfterFirst = backupsOf(path);

		const second = registerClient("omo", LAUNCH, {}, context({}, new Date(2026, 9, 6, 12, 0, 5)));

		expect(second.changed).toBe(false);
		expect(readFileSync(path, "utf8")).toBe(afterFirst);
		expect(backupsOf(path)).toEqual(backupsAfterFirst);
		expect(backupsAfterFirst).toHaveLength(1);
	});

	it("updates only the managed fields of an existing entry and keeps an allow list that is not given", () => {
		const path = join(home, ".omo/agent/mcp.json");
		const existing = {
			command: "/old/launcher",
			args: ["/old/server.js"],
			env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder", APPLE_CUA_IPHONE: "1" },
			enabled: true,
		};
		writeConfig(path, JSON.stringify({ mcpServers: { "apple-cua": existing } }));

		registerClient("omo", LAUNCH, { toolset: "lean" }, context());
		const kept = JSON.parse(readFileSync(path, "utf8")).mcpServers["apple-cua"];
		registerClient("omo", LAUNCH, { allow: "com.apple.TextEdit" }, context({}, new Date(2026, 9, 6, 12, 0, 9)));
		const replaced = JSON.parse(readFileSync(path, "utf8")).mcpServers["apple-cua"];

		expect(kept).toEqual({
			command: LAUNCH.command,
			args: LAUNCH.args,
			env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder", APPLE_CUA_IPHONE: "1", APPLE_CUA_TOOLSET: "lean" },
			enabled: true,
		});
		expect(replaced.env).toEqual({
			APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
			APPLE_CUA_IPHONE: "1",
			APPLE_CUA_TOOLSET: "lean",
		});
	});

	it("refuses a file that is not JSON and leaves it and its directory untouched", () => {
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(path, "{ not json");

		expect(() => registerClient("omo", LAUNCH, { allow: "com.apple.TextEdit" }, context())).toThrow(
			/cannot be read as JSON/,
		);
		expect(readFileSync(path, "utf8")).toBe("{ not json");
		expect(backupsOf(path)).toEqual([]);
	});

	it("writes through a symlinked config so the link survives", () => {
		const target = join(home, "dotfiles/mcp.json");
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(target, JSON.stringify({ mcpServers: { other: { command: "other" } } }));
		mkdirSync(dirname(path), { recursive: true });
		symlinkSync(target, path);

		registerClient("omo", LAUNCH, {}, context());

		expect(lstatSync(path).isSymbolicLink()).toBe(true);
		expect(Object.keys(JSON.parse(readFileSync(target, "utf8")).mcpServers)).toEqual(["other", "apple-cua"]);
	});
});

describe("#given a Codex config.toml #when apple-cua is registered #then only its table changes", () => {
	it("appends the table once, keeps every other byte, and is unchanged on a second run", () => {
		const path = join(home, ".codex/config.toml");
		const original = [
			'model = "gpt-5"',
			"",
			"# servers",
			"[mcp_servers.codegraph]",
			'command = "codegraph"',
			'args = ["serve", "--mcp"]',
			"",
			"[mcp_servers.node_repl.env]",
			'A = "1"',
			"",
		].join("\n");
		writeConfig(path, original);

		const first = registerClient("codex", LAUNCH, { allow: "com.apple.TextEdit", delivery: "background" }, context());
		const afterFirst = readFileSync(path, "utf8");
		const second = registerClient("codex", LAUNCH, {}, context({}, new Date(2026, 9, 6, 12, 1, 0)));

		expect(afterFirst.startsWith(original)).toBe(true);
		expect(afterFirst.slice(original.length)).toBe(
			[
				"",
				"[mcp_servers.apple-cua]",
				`command = "${LAUNCH.command}"`,
				`args = ["${LAUNCH.args[0]}"]`,
				"",
				"[mcp_servers.apple-cua.env]",
				'APPLE_CUA_ALLOWED_BUNDLE_IDS = "com.apple.TextEdit"',
				'APPLE_CUA_DELIVERY = "background"',
				"",
			].join("\n"),
		);
		expect(first.changed).toBe(true);
		expect(readFileSync(first.backup, "utf8")).toBe(original);
		expect(second.changed).toBe(false);
		expect(readFileSync(path, "utf8")).toBe(afterFirst);
		expect(backupsOf(path)).toHaveLength(1);
	});

	it("rewrites an existing table in place, merging its inline env and keeping its other keys and sub-tables", () => {
		const path = join(home, ".codex/config.toml");
		writeConfig(
			path,
			[
				"[mcp_servers.first]",
				'command = "first"',
				"",
				"[mcp_servers.apple-cua]",
				'command = "/old/launcher"',
				"args = [",
				'  "/old/server.js",',
				"]",
				'env = { APPLE_CUA_ALLOWED_BUNDLE_IDS = "com.apple.finder", APPLE_CUA_IPHONE = "1" }',
				"startup_timeout_sec = 20",
				"",
				"[mcp_servers.apple-cua.tools.ask_user]",
				'approval = "never"',
				"",
				"# the last one",
				"[mcp_servers.last]",
				'command = "last"',
				"",
			].join("\n"),
		);

		const result = registerClient("codex", LAUNCH, { toolset: "lean" }, context());

		expect(readFileSync(path, "utf8")).toBe(
			[
				"[mcp_servers.first]",
				'command = "first"',
				"",
				"[mcp_servers.apple-cua]",
				`command = "${LAUNCH.command}"`,
				`args = ["${LAUNCH.args[0]}"]`,
				"startup_timeout_sec = 20",
				"",
				"[mcp_servers.apple-cua.env]",
				'APPLE_CUA_ALLOWED_BUNDLE_IDS = "com.apple.finder"',
				'APPLE_CUA_IPHONE = "1"',
				'APPLE_CUA_TOOLSET = "lean"',
				"",
				"[mcp_servers.apple-cua.tools.ask_user]",
				'approval = "never"',
				"",
				"# the last one",
				"[mcp_servers.last]",
				'command = "last"',
				"",
			].join("\n"),
		);
		expect(result.before).toMatchObject({ command: "/old/launcher", args: ["/old/server.js"] });
		expect(registerClient("codex", LAUNCH, {}, context()).changed).toBe(false);
	});

	it("refuses a layout it does not edit and writes nothing", () => {
		const path = join(home, ".codex/config.toml");
		writeConfig(path, 'mcp_servers.apple-cua.command = "x"\n');

		expect(() => registerClient("codex", LAUNCH, {}, context())).toThrow(/does not edit/);
		expect(readFileSync(path, "utf8")).toBe('mcp_servers.apple-cua.command = "x"\n');
		expect(backupsOf(path)).toEqual([]);
	});
});

describe("#given Claude Code #when apple-cua is registered #then the claude CLI does the write", () => {
	function fakeClaude() {
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		const script = join(bin, "claude");
		writeFileSync(script, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CLAUDE_LOG"\n');
		chmodSync(script, 0o755);
		return { PATH: bin, CLAUDE_LOG: join(home, "claude.log") };
	}

	it("prints the block and touches nothing when the claude CLI is not installed", () => {
		const result = registerClient("claude", LAUNCH, { allow: "com.apple.TextEdit" }, context());

		expect(result.printed).toEqual({
			mcpServers: {
				"apple-cua": {
					type: "stdio",
					command: LAUNCH.command,
					args: LAUNCH.args,
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" },
				},
			},
		});
		expect(existsSync(join(home, ".claude.json"))).toBe(false);
	});

	it("backs up the config, then replaces an older user-scope entry through the CLI", () => {
		const env = fakeClaude();
		const config = {
			numStartups: 3,
			mcpServers: {
				"apple-cua": {
					type: "stdio",
					command: "/old/launcher",
					args: ["/old/server.js"],
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder" },
				},
			},
		};
		writeConfig(join(home, ".claude.json"), JSON.stringify(config));

		const result = registerClient("claude", LAUNCH, {}, context(env));

		expect(readFileSync(env.CLAUDE_LOG, "utf8").trim().split("\n")).toEqual([
			"mcp remove apple-cua --scope user",
			`mcp add --scope user apple-cua -e APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.finder -- ${LAUNCH.command} ${LAUNCH.args[0]}`,
		]);
		expect(JSON.parse(readFileSync(result.backup, "utf8"))).toEqual(config);
	});

	it("does not call the CLI when the user-scope entry already matches", () => {
		const env = fakeClaude();
		const entry = {
			type: "stdio",
			command: LAUNCH.command,
			args: LAUNCH.args,
			env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" },
		};
		writeConfig(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "apple-cua": entry } }));

		const result = registerClient("claude", LAUNCH, {}, context(env));

		expect(result.changed).toBe(false);
		expect(existsSync(env.CLAUDE_LOG)).toBe(false);
		expect(backupsOf(join(home, ".claude.json"))).toEqual([]);
	});
});

describe("#given the json client #when apple-cua is registered #then a block is printed and nothing is written", () => {
	it("prints the launch command with the given options", () => {
		const result = registerClient("json", LAUNCH, { allow: "com.apple.TextEdit", toolset: "lean" }, context());

		expect(result.printed).toEqual({
			mcpServers: {
				"apple-cua": {
					command: LAUNCH.command,
					args: LAUNCH.args,
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit", APPLE_CUA_TOOLSET: "lean" },
				},
			},
		});
		expect(readdirSync(home)).toEqual([]);
	});
});
