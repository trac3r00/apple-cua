import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_SETTINGS,
	adoptRegistrations,
	applyToClients,
	changeSettings,
	desiredRegistration,
	envForSettings,
	envMatchesSettings,
	findAppBundleId,
	loadSettings,
	looksLikeBundleId,
	parseSettings,
	resolveApps,
	saveSettings,
} from "./settings.js";

const APPS = new Map([
	["textedit", "com.apple.TextEdit"],
	["finder", "com.apple.finder"],
	["safari", "com.apple.Safari"],
]);
const resolver = (name: string) => APPS.get(name.toLowerCase());

let home = "";

beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-settings-")));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function writeConfig(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

describe("#given config.json #when settings are saved and loaded #then they round-trip, private to the user", () => {
	it("defaults without a file, writes it 0600, and reads back what was saved", () => {
		const path = join(home, ".apple-cua/config.json");
		const settings = {
			allowedApps: ["com.apple.TextEdit"],
			delivery: "attended",
			toolset: "lean",
			iphone: true,
			clients: ["omo", "codex"],
		} as const;

		const before = loadSettings(path);
		saveSettings(path, settings);

		expect(before).toEqual({ settings: DEFAULT_SETTINGS, saved: false });
		expect(loadSettings(path)).toEqual({ settings, saved: true });
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(settings);
	});

	it("names the file and the key when a value has the wrong type", () => {
		expect(() => parseSettings("{ nope", "/c.json")).toThrow(/\/c\.json is not valid JSON/);
		expect(() => parseSettings('{ "delivery": "loud" }', "/c.json")).toThrow(/"delivery" must be/);
		expect(() => parseSettings('{ "clients": ["windsurf"] }', "/c.json")).toThrow(/"clients" must be/);
		expect(() => parseSettings('{ "allowedApps": "com.apple.TextEdit" }', "/c.json")).toThrow(/"allowedApps"/);
		expect(parseSettings('{ "clients": ["codex", "omo", "codex"] }', "/c.json").clients).toEqual(["omo", "codex"]);
	});
});

describe("#given cursor motion #when settings are saved, changed and mapped to env #then it is optional and canonical", () => {
	const motion = { style: "spring_settle", timing: "fitts", spring: 0.5 } as const;
	const reordered = { spring: 0.5, timing: "fitts", style: "spring_settle" } as const;

	it("loads older config without it, and round-trips enabled and disabled", () => {
		const path = join(home, ".apple-cua/config.json");
		writeConfig(path, '{ "delivery": "attended" }');
		expect(loadSettings(path).settings.cursorMotion).toBeUndefined();

		saveSettings(path, { ...DEFAULT_SETTINGS, cursorMotion: reordered });
		expect(loadSettings(path).settings.cursorMotion).toEqual(motion);
		expect(JSON.parse(readFileSync(path, "utf8")).cursorMotion).toEqual(motion);

		saveSettings(path, DEFAULT_SETTINGS);
		expect("cursorMotion" in JSON.parse(readFileSync(path, "utf8"))).toBe(false);
		expect(parseSettings('{ "cursorMotion": "magnetic" }', "/c.json").cursorMotion).toEqual({ style: "magnetic" });
		expect(parseSettings('{ "cursorMotion": "off" }', "/c.json").cursorMotion).toBeUndefined();
	});

	it("rejects invalid saved values naming the file and key", () => {
		expect(() => parseSettings('{ "cursorMotion": "zigzag" }', "/c.json")).toThrow(/\/c\.json: "cursorMotion"/);
		expect(() => parseSettings('{ "cursorMotion": { "style": "magnetic", "spring": 9 } }', "/c.json")).toThrow(
			/spring/,
		);
	});

	it("changes, keeps and disables it explicitly", () => {
		const enabled = changeSettings(DEFAULT_SETTINGS, { cursorMotion: motion }, resolver).settings;
		const kept = changeSettings(enabled, { delivery: "attended" }, resolver).settings;
		const disabled = changeSettings(enabled, { cursorMotion: null }, resolver).settings;

		expect(enabled.cursorMotion).toEqual(motion);
		expect(kept.cursorMotion).toEqual(motion);
		expect("cursorMotion" in disabled).toBe(false);
		expect(() => changeSettings(enabled, { cursorMotion: { style: "magnetic", arcSize: 2 } }, resolver)).toThrow(
			/arcSize/,
		);
	});

	it("serializes to the env, compares canonically, and treats empty or off as disabled", () => {
		const settings = { ...DEFAULT_SETTINGS, cursorMotion: reordered };
		const env = envForSettings(settings);

		expect(env["APPLE_CUA_CURSOR_MOTION"]).toBe('{"style":"spring_settle","timing":"fitts","spring":0.5}');
		expect(envForSettings(DEFAULT_SETTINGS)["APPLE_CUA_CURSOR_MOTION"]).toBeUndefined();
		expect(envMatchesSettings({ APPLE_CUA_CURSOR_MOTION: JSON.stringify(reordered) }, settings)).toBe(true);
		expect(envMatchesSettings({}, settings)).toBe(false);
		expect(envMatchesSettings({ APPLE_CUA_CURSOR_MOTION: "magnetic" }, DEFAULT_SETTINGS)).toBe(false);
		expect(envMatchesSettings({ APPLE_CUA_CURSOR_MOTION: " " }, DEFAULT_SETTINGS)).toBe(true);
		expect(envMatchesSettings({ APPLE_CUA_CURSOR_MOTION: "off" }, DEFAULT_SETTINGS)).toBe(true);
		expect(envMatchesSettings({ APPLE_CUA_CURSOR_MOTION: "{ nope" }, DEFAULT_SETTINGS)).toBe(false);
		expect(envMatchesSettings({ APPLE_CUA_CURSOR_MOTION: '{"style":"nope"}' }, DEFAULT_SETTINGS)).toBe(false);
	});

	it("adopts it from a registration that runs this checkout", () => {
		const checkout = join(home, "checkout");
		const layout = {
			checkout,
			helperExecutable: join(checkout, "packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp"),
			server: join(checkout, "packages/mcp/dist/server.js"),
		};
		mkdirSync(dirname(layout.helperExecutable), { recursive: true });
		writeFileSync(layout.helperExecutable, "");
		writeConfig(
			join(home, ".omo/agent/mcp.json"),
			JSON.stringify({
				mcpServers: {
					"apple-cua": {
						command: layout.helperExecutable,
						args: [layout.server],
						env: { APPLE_CUA_CURSOR_MOTION: JSON.stringify(reordered) },
					},
				},
			}),
		);

		expect(adoptRegistrations(layout, { home, env: {}, now: new Date() })?.cursorMotion).toEqual(motion);
	});

	it("reapplies to a registration whose env carries the old motion", () => {
		const desired = desiredRegistration(
			{ helperExecutable: "/c/helper", server: "/c/server.js" },
			{ ...DEFAULT_SETTINGS, cursorMotion: motion },
		);

		expect(desired.env["APPLE_CUA_CURSOR_MOTION"]).toBe(JSON.stringify(motion));
		expect(desired.envSatisfied?.({ APPLE_CUA_CURSOR_MOTION: "classic" })).toBe(false);
		expect(desired.envSatisfied?.({ APPLE_CUA_CURSOR_MOTION: JSON.stringify(reordered) })).toBe(true);
	});
});

describe("#given settings #when a change is applied #then apps resolve by name and lists merge", () => {
	it("adds apps by name or bundle id without duplicates, and reports a name that matches no app", () => {
		const first = changeSettings(DEFAULT_SETTINGS, { allow: ["TextEdit,com.apple.finder", "textedit"] }, resolver);
		const unknown = changeSettings(first.settings, { allow: ["Nonexistent App"] }, resolver);

		expect(first).toEqual({
			settings: { ...DEFAULT_SETTINGS, allowedApps: ["com.apple.TextEdit", "com.apple.finder"] },
			unknown: [],
		});
		expect(unknown.unknown).toEqual(["Nonexistent App"]);
	});

	it("withdraws apps by name or bundle id in any case, and empties the list with all", () => {
		const settings = {
			...DEFAULT_SETTINGS,
			allowedApps: ["com.apple.TextEdit", "com.apple.finder", "com.apple.Safari"],
		};

		expect(
			changeSettings(settings, { disallow: ["Finder", "com.apple.textedit"] }, resolver).settings.allowedApps,
		).toEqual(["com.apple.Safari"]);
		expect(changeSettings(settings, { disallow: ["all"], allow: ["Safari"] }, resolver).settings.allowedApps).toEqual(
			["com.apple.Safari"],
		);
	});

	it("keeps clients in one order and lets unregister win over register", () => {
		const settings = { ...DEFAULT_SETTINGS, clients: ["codex"] as const };

		expect(changeSettings(settings, { register: ["json", "omo"] }, resolver).settings.clients).toEqual([
			"omo",
			"codex",
			"json",
		]);
		expect(
			changeSettings(settings, { register: ["omo"], unregister: ["codex", "omo"] }, resolver).settings.clients,
		).toEqual([]);
	});
});

describe("#given the server's environment variables #when settings are mapped to them #then the server's own rules apply", () => {
	it("writes every managed variable and reads defaults like the server", () => {
		const settings = { ...DEFAULT_SETTINGS, allowedApps: ["com.apple.TextEdit"] };

		expect(envForSettings(settings)).toEqual({
			APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
			APPLE_CUA_DELIVERY: "background",
			APPLE_CUA_TOOLSET: "full",
			APPLE_CUA_IPHONE: undefined,
		});
		expect(envMatchesSettings({ APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" }, settings)).toBe(true);
		expect(
			envMatchesSettings(
				{ APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit", APPLE_CUA_TOOLSET: "LEAN" },
				settings,
			),
		).toBe(false);
		expect(envMatchesSettings({}, DEFAULT_SETTINGS)).toBe(true);
	});
});

describe("#given registrations made before config.json existed #when settings are adopted #then only this checkout's count", () => {
	it("reads the settings and clients of entries that run this checkout and ignores another installation", () => {
		const checkout = join(home, "checkout");
		const layout = {
			checkout,
			helperExecutable: join(checkout, "packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp"),
			server: join(checkout, "packages/mcp/dist/server.js"),
		};
		mkdirSync(dirname(layout.helperExecutable), { recursive: true });
		writeFileSync(layout.helperExecutable, "");
		writeConfig(
			join(home, ".omo/agent/mcp.json"),
			JSON.stringify({
				mcpServers: {
					"apple-cua": {
						command: layout.helperExecutable,
						args: [layout.server],
						env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder", APPLE_CUA_TOOLSET: "lean" },
					},
				},
			}),
		);
		writeConfig(
			join(home, ".codex/config.toml"),
			'[mcp_servers.apple-cua]\ncommand = "/other/checkout/apple-cua-mcp"\nargs = ["/other/checkout/server.js"]\n',
		);

		const adopted = adoptRegistrations(layout, { home, env: {}, now: new Date() });

		expect(adopted).toEqual({
			allowedApps: ["com.apple.finder"],
			delivery: "background",
			toolset: "lean",
			iphone: false,
			clients: ["omo"],
		});
	});
});

describe("#given several clients #when settings are applied #then one failing client does not stop the others", () => {
	it("registers codex even though omo's file cannot be parsed, and reports omo", () => {
		writeConfig(join(home, ".omo/agent/mcp.json"), "{ broken");
		const desired = desiredRegistration({ helperExecutable: "/c/helper", server: "/c/server.js" }, DEFAULT_SETTINGS);

		const outcome = applyToClients(["omo", "codex"], desired, { home, env: {}, now: new Date() });

		expect(outcome.failures.map((failure) => failure.client)).toEqual(["omo"]);
		expect(outcome.changes.map((change) => `${change.client} ${change.action}`)).toEqual(["codex added"]);
	});
});

describe("#given app names #when they are resolved #then bundle ids pass through and names are looked up", () => {
	it("tells bundle ids from names and resolves a real app", () => {
		expect(looksLikeBundleId("com.apple.TextEdit")).toBe(true);
		expect(looksLikeBundleId("TextEdit")).toBe(false);
		expect(looksLikeBundleId("TextEdit.app")).toBe(false);
		expect(looksLikeBundleId("com.example.App")).toBe(true);
		expect(resolveApps(["com.example.App, TextEdit", " "], resolver)).toEqual({
			ids: ["com.example.App", "com.apple.TextEdit"],
			unknown: [],
		});
		expect(findAppBundleId("TextEdit", home)).toBe("com.apple.TextEdit");
	});
});
