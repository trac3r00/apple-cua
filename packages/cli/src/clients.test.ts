import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type ClientContext,
	type DesiredRegistration,
	entryAlive,
	entryRunsCheckout,
	inspectClient,
	registerClient,
	unregisterClient,
} from "./clients.js";
import { DEFAULT_SETTINGS, type Settings, desiredRegistration } from "./settings.js";

const LAYOUT = {
	helperExecutable: "/checkout/packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp",
	server: "/checkout/packages/mcp/dist/server.js",
};
const DEFAULT_ENV = { APPLE_CUA_DELIVERY: "background", APPLE_CUA_TOOLSET: "full" };
const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 6, 12, 0, 5);

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "apple-cua-clients-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function context(env: Readonly<Record<string, string>> = {}, now = NOW): ClientContext {
	return { home, env: { PATH: "", ...env }, now };
}

function desired(settings: Partial<Settings> = {}): DesiredRegistration {
	return desiredRegistration(LAYOUT, { ...DEFAULT_SETTINGS, ...settings });
}

function backupsOf(path: string): string[] {
	return readdirSync(dirname(path)).filter((entry) => entry.startsWith(`${basename(path)}.bak-`));
}

function writeConfig(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, { mode: 0o600 });
}

describe("#given an omo config with other servers #when apple-cua is registered #then it is merged, backed up and idempotent", () => {
	it("adds the entry with the settings as env, keeps every other server and setting, and backs up the original", () => {
		const path = join(home, ".omo/agent/mcp.json");
		const original = {
			mcpServers: {
				codegraph: { command: "codegraph", args: ["serve", "--mcp"] },
				remote: { type: "http", url: "http://127.0.0.1:1/mcp", enabled: true },
			},
			other: { keep: true },
		};
		writeConfig(path, `${JSON.stringify(original, null, 2)}\n`);

		const change = registerClient(
			"omo",
			desired({ allowedApps: ["com.apple.TextEdit", "com.apple.finder"] }),
			context(),
		);

		const written = JSON.parse(readFileSync(path, "utf8"));
		expect(written.mcpServers.codegraph).toEqual(original.mcpServers.codegraph);
		expect(written.mcpServers.remote).toEqual(original.mcpServers.remote);
		expect(written.other).toEqual({ keep: true });
		expect(written.mcpServers["apple-cua"]).toEqual({
			command: LAYOUT.helperExecutable,
			args: [LAYOUT.server],
			env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit,com.apple.finder", ...DEFAULT_ENV },
		});
		expect(change.action).toBe("added");
		expect(JSON.parse(readFileSync(change.backup ?? "", "utf8"))).toEqual(original);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(change.backup ?? "").mode & 0o777).toBe(0o600);
	});

	it("writes nothing and adds no backup when the same registration runs again", () => {
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(path, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
		registerClient("omo", desired({ allowedApps: ["com.apple.TextEdit"] }), context());
		const afterFirst = readFileSync(path, "utf8");

		const second = registerClient("omo", desired({ allowedApps: ["com.apple.TextEdit"] }), context({}, LATER));

		expect(second.action).toBe("unchanged");
		expect(readFileSync(path, "utf8")).toBe(afterFirst);
		expect(backupsOf(path)).toHaveLength(1);
	});

	it("leaves an older entry alone when it already means the same settings", () => {
		const path = join(home, ".omo/agent/mcp.json");
		const text = `${JSON.stringify(
			{
				mcpServers: {
					"apple-cua": {
						command: LAYOUT.helperExecutable,
						args: [LAYOUT.server],
						env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" },
					},
				},
			},
			null,
			2,
		)}\n`;
		writeConfig(path, text);

		const change = registerClient("omo", desired({ allowedApps: ["com.apple.TextEdit"] }), context());

		expect(change.action).toBe("unchanged");
		expect(readFileSync(path, "utf8")).toBe(text);
		expect(backupsOf(path)).toEqual([]);
	});

	it("rewrites the managed values of an outdated entry and keeps its other keys and variables", () => {
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(
			path,
			JSON.stringify({
				mcpServers: {
					"apple-cua": {
						command: "/old/launcher",
						args: ["/old/server.js"],
						env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder", EXTRA: "1" },
						enabled: true,
					},
				},
			}),
		);

		const change = registerClient(
			"omo",
			desired({ allowedApps: ["com.apple.TextEdit"], toolset: "lean", iphone: true }),
			context(),
		);

		expect(change.action).toBe("updated");
		expect(JSON.parse(readFileSync(path, "utf8")).mcpServers["apple-cua"]).toEqual({
			command: LAYOUT.helperExecutable,
			args: [LAYOUT.server],
			env: {
				EXTRA: "1",
				APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
				APPLE_CUA_DELIVERY: "background",
				APPLE_CUA_TOOLSET: "lean",
				APPLE_CUA_IPHONE: "1",
			},
			enabled: true,
		});
	});

	it("refuses a file that is not JSON and leaves it untouched", () => {
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(path, "{ not json");

		expect(() => registerClient("omo", desired(), context())).toThrow(/cannot be read as JSON/);
		expect(readFileSync(path, "utf8")).toBe("{ not json");
		expect(backupsOf(path)).toEqual([]);
	});

	it("writes through a symlinked config so the link survives", () => {
		const target = join(home, "dotfiles/mcp.json");
		const path = join(home, ".omo/agent/mcp.json");
		writeConfig(target, JSON.stringify({ mcpServers: { other: { command: "other" } } }));
		mkdirSync(dirname(path), { recursive: true });
		symlinkSync(target, path);

		registerClient("omo", desired(), context());

		expect(lstatSync(path).isSymbolicLink()).toBe(true);
		expect(Object.keys(JSON.parse(readFileSync(target, "utf8")).mcpServers)).toEqual(["other", "apple-cua"]);
	});
});

describe("#given a registered omo config #when apple-cua is unregistered #then only its entry goes, after a backup", () => {
	it("restores the other servers byte for byte and does nothing the second time", () => {
		const path = join(home, ".omo/agent/mcp.json");
		const original = `${JSON.stringify({ mcpServers: { codegraph: { command: "codegraph" } }, other: true }, null, 2)}\n`;
		writeConfig(path, original);
		registerClient("omo", desired(), context());

		const removed = unregisterClient("omo", context({}, LATER));
		const again = unregisterClient("omo", context({}, LATER));

		expect(removed.action).toBe("removed");
		expect(removed.backup).toBeDefined();
		expect(readFileSync(path, "utf8")).toBe(original);
		expect(again.action).toBe("absent");
		expect(backupsOf(path)).toHaveLength(2);
	});
});

describe("#given a Codex config.toml #when apple-cua is registered and unregistered #then only its table changes", () => {
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

	it("appends the table once, keeps every other byte, and unregistering restores the file", () => {
		const path = join(home, ".codex/config.toml");
		writeConfig(path, original);

		const first = registerClient("codex", desired({ allowedApps: ["com.apple.TextEdit"] }), context());
		const afterFirst = readFileSync(path, "utf8");
		const second = registerClient("codex", desired({ allowedApps: ["com.apple.TextEdit"] }), context({}, LATER));
		const removed = unregisterClient("codex", context({}, LATER));

		expect(afterFirst.slice(0, original.length)).toBe(original);
		expect(afterFirst.slice(original.length)).toBe(
			[
				"",
				"[mcp_servers.apple-cua]",
				`command = "${LAYOUT.helperExecutable}"`,
				`args = ["${LAYOUT.server}"]`,
				"",
				"[mcp_servers.apple-cua.env]",
				'APPLE_CUA_ALLOWED_BUNDLE_IDS = "com.apple.TextEdit"',
				'APPLE_CUA_DELIVERY = "background"',
				'APPLE_CUA_TOOLSET = "full"',
				"",
			].join("\n"),
		);
		expect(first.action).toBe("added");
		expect(readFileSync(first.backup ?? "", "utf8")).toBe(original);
		expect(second.action).toBe("unchanged");
		expect(removed.action).toBe("removed");
		expect(readFileSync(path, "utf8")).toBe(original);
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
				'env = { APPLE_CUA_ALLOWED_BUNDLE_IDS = "com.apple.finder", EXTRA = "1" }',
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
		const settings = { allowedApps: ["com.apple.finder"], toolset: "lean" } as const;

		const change = registerClient("codex", desired(settings), context());

		expect(readFileSync(path, "utf8")).toBe(
			[
				"[mcp_servers.first]",
				'command = "first"',
				"",
				"[mcp_servers.apple-cua]",
				`command = "${LAYOUT.helperExecutable}"`,
				`args = ["${LAYOUT.server}"]`,
				"startup_timeout_sec = 20",
				"",
				"[mcp_servers.apple-cua.env]",
				'APPLE_CUA_ALLOWED_BUNDLE_IDS = "com.apple.finder"',
				'EXTRA = "1"',
				'APPLE_CUA_DELIVERY = "background"',
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
		expect(change.before).toMatchObject({ command: "/old/launcher", args: ["/old/server.js"] });
		expect(registerClient("codex", desired(settings), context()).action).toBe("unchanged");
	});

	it("refuses a layout it does not edit and writes nothing", () => {
		const path = join(home, ".codex/config.toml");
		writeConfig(path, 'mcp_servers.apple-cua.command = "x"\n');

		expect(() => registerClient("codex", desired(), context())).toThrow(/does not edit/);
		expect(() => unregisterClient("codex", context())).toThrow(/cannot be edited/);
		expect(readFileSync(path, "utf8")).toBe('mcp_servers.apple-cua.command = "x"\n');
		expect(backupsOf(path)).toEqual([]);
	});
});

describe("#given Claude Code #when apple-cua is registered or unregistered #then the claude CLI does the write", () => {
	function fakeClaude(): { PATH: string; CLAUDE_LOG: string } {
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		const script = join(bin, "claude");
		writeFileSync(script, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CLAUDE_LOG"\n');
		chmodSync(script, 0o755);
		return { PATH: bin, CLAUDE_LOG: join(home, "claude.log") };
	}

	it("prints the block, touches nothing, and counts as a manual step when the claude CLI is not installed", () => {
		const change = registerClient("claude", desired({ allowedApps: ["com.apple.TextEdit"] }), context());

		expect(change.action).toBe("printed");
		expect(change.printed).toEqual({
			mcpServers: {
				"apple-cua": {
					type: "stdio",
					command: LAYOUT.helperExecutable,
					args: [LAYOUT.server],
					env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit", ...DEFAULT_ENV },
				},
			},
		});
		expect(existsSync(join(home, ".claude.json"))).toBe(false);
		expect(inspectClient("claude", desired(), context()).state).toBe("manual");
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

		const change = registerClient("claude", desired({ allowedApps: ["com.apple.finder"] }), context(env));

		expect(readFileSync(env.CLAUDE_LOG, "utf8").trim().split("\n")).toEqual([
			"mcp remove apple-cua --scope user",
			`mcp add --scope user apple-cua -e APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.finder -e APPLE_CUA_DELIVERY=background -e APPLE_CUA_TOOLSET=full -- ${LAYOUT.helperExecutable} ${LAYOUT.server}`,
		]);
		expect(JSON.parse(readFileSync(change.backup ?? "", "utf8"))).toEqual(config);
	});

	it("does not call the CLI when the user-scope entry already matches", () => {
		const env = fakeClaude();
		writeConfig(
			join(home, ".claude.json"),
			JSON.stringify({
				mcpServers: {
					"apple-cua": {
						type: "stdio",
						command: LAYOUT.helperExecutable,
						args: [LAYOUT.server],
						env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" },
					},
				},
			}),
		);

		const change = registerClient("claude", desired({ allowedApps: ["com.apple.TextEdit"] }), context(env));

		expect(change.action).toBe("unchanged");
		expect(existsSync(env.CLAUDE_LOG)).toBe(false);
		expect(backupsOf(join(home, ".claude.json"))).toEqual([]);
	});

	it("unregisters through the CLI after a backup", () => {
		const env = fakeClaude();
		writeConfig(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "apple-cua": { command: "/x" } } }));

		const change = unregisterClient("claude", context(env));

		expect(change.action).toBe("removed");
		expect(change.backup).toBeDefined();
		expect(readFileSync(env.CLAUDE_LOG, "utf8").trim()).toBe("mcp remove apple-cua --scope user");
	});
});

describe("#given the json client #when apple-cua is registered #then a block is printed and nothing is written", () => {
	it("prints the launch command with the settings", () => {
		const change = registerClient(
			"json",
			desired({ allowedApps: ["com.apple.TextEdit"], toolset: "lean" }),
			context(),
		);

		expect(change.printed).toEqual({
			mcpServers: {
				"apple-cua": {
					command: LAYOUT.helperExecutable,
					args: [LAYOUT.server],
					env: {
						APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
						APPLE_CUA_DELIVERY: "background",
						APPLE_CUA_TOOLSET: "lean",
					},
				},
			},
		});
		expect(readdirSync(home)).toEqual([]);
	});
});

describe("#given client configs in different states #when they are inspected #then each state is told apart without writing", () => {
	it("reports stale, missing, current and unreadable registrations", () => {
		const omo = join(home, ".omo/agent/mcp.json");
		writeConfig(
			omo,
			JSON.stringify({ mcpServers: { "apple-cua": { command: "/gone/apple-cua-mcp", args: [LAYOUT.server] } } }),
		);

		expect(inspectClient("omo", desired(), context())).toMatchObject({
			state: "stale",
			detail: expect.stringContaining("/gone/apple-cua-mcp"),
		});
		expect(inspectClient("codex", desired(), context()).state).toBe("missing");
		registerClient("codex", desired(), context());
		expect(inspectClient("codex", desired(), context()).state).toBe("current");
		expect(inspectClient("codex", desired({ allowedApps: ["com.apple.TextEdit"] }), context())).toMatchObject({
			state: "stale",
			detail: "its environment differs from the saved settings",
		});
		writeConfig(omo, "{ broken");
		expect(inspectClient("omo", desired(), context()).state).toBe("unreadable");
		expect(inspectClient("json", desired(), context()).state).toBe("manual");
	});
});

describe("#given registered entries #when their installation is asked #then the helper path or the server.js argument decides", () => {
	it("tells this checkout's entries from another installation's and a deleted one's", () => {
		const checkout = join(home, "checkout");
		const helper = join(checkout, "packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp");
		const server = join(checkout, "packages/mcp/dist/server.js");
		mkdirSync(dirname(helper), { recursive: true });
		writeFileSync(helper, "");
		writeFileSync(server, "");
		const canonicalCheckout = realpathSync(checkout);

		expect(entryRunsCheckout({ command: helper, args: [server], env: {} }, canonicalCheckout)).toBe(true);
		expect(entryRunsCheckout({ command: "node", args: [server], env: {} }, canonicalCheckout)).toBe(true);
		expect(entryRunsCheckout({ command: "/elsewhere/apple-cua-mcp", args: [], env: {} }, canonicalCheckout)).toBe(
			false,
		);
		expect(entryAlive({ command: helper, args: [server], env: {} })).toBe(true);
		expect(entryAlive({ command: "/gone/apple-cua-mcp", args: ["/gone/server.js"], env: {} })).toBe(false);
		expect(entryAlive({ command: "npx", args: ["some-package"], env: {} })).toBe(true);
	});
});
