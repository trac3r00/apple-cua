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
		expect(() => parseSettings('{ "clients": ["cursor"] }', "/c.json")).toThrow(/"clients" must be/);
		expect(() => parseSettings('{ "allowedApps": "com.apple.TextEdit" }', "/c.json")).toThrow(/"allowedApps"/);
		expect(parseSettings('{ "clients": ["codex", "omo", "codex"] }', "/c.json").clients).toEqual(["omo", "codex"]);
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
	it("writes every managed variable, drops the pre-rename names, and reads defaults and legacy names like the server", () => {
		const settings = { ...DEFAULT_SETTINGS, allowedApps: ["com.apple.TextEdit"] };

		expect(envForSettings(settings)).toEqual({
			APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
			APPLE_CUA_DELIVERY: "background",
			APPLE_CUA_TOOLSET: "full",
			APPLE_CUA_IPHONE: undefined,
			MACOS_CUA_ALLOWED_BUNDLE_IDS: undefined,
			MACOS_CUA_DELIVERY: undefined,
		});
		expect(envMatchesSettings({ MACOS_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" }, settings)).toBe(true);
		expect(
			envMatchesSettings(
				{ APPLE_CUA_ALLOWED_BUNDLE_IDS: "", MACOS_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit" },
				settings,
			),
		).toBe(true);
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
