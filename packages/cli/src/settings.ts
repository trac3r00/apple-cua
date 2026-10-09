// The user's apple-cua settings, kept in $APPLE_CUA_HOME/config.json (default ~/.apple-cua/config.json). They are
// the source of truth for every MCP client registration: each registered client's apple-cua entry carries them as
// environment variables, and a settings change is applied to all of them.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	CURSOR_MOTION_ENV,
	type CursorMotionConfig,
	cursorMotionFromEnvironment,
	parseCursorMotion,
} from "@apple-cua/core";
import { type BundleInputs, type BundlePlan, planBundle, readSkillFiles, writeBundle } from "./bundle.js";
import {
	CLIENT_NAMES,
	type ClientChange,
	type ClientContext,
	type ClientName,
	type DesiredRegistration,
	type EnvMap,
	type EnvUpdate,
	entryRunsCheckout,
	isClientName,
	readClientEntry,
	registerClient,
} from "./clients.js";
import type { Layout } from "./layout.js";

export type Delivery = "background" | "attended";
export type Toolset = "full" | "lean";

export interface Settings {
	/** Bundle ids of the apps the server may observe and drive. */
	readonly allowedApps: readonly string[];
	readonly delivery: Delivery;
	readonly toolset: Toolset;
	/** Register the iPhone Mirroring tools. */
	readonly iphone: boolean;
	/** Cua Cursor Motion for the pointer overlay; omitted when disabled. */
	readonly cursorMotion?: CursorMotionConfig | undefined;
	/** The MCP clients apple-cua is registered with; settings changes are applied to each of them. */
	readonly clients: readonly ClientName[];
}

export const DEFAULT_SETTINGS: Settings = {
	allowedApps: [],
	delivery: "background",
	toolset: "full",
	iphone: false,
	clients: [],
};

const ALLOW_ENV = "APPLE_CUA_ALLOWED_BUNDLE_IDS";
const DELIVERY_ENV = "APPLE_CUA_DELIVERY";
const TOOLSET_ENV = "APPLE_CUA_TOOLSET";
const IPHONE_ENV = "APPLE_CUA_IPHONE";

const MOTION_KEYS = [
	"style",
	"timing",
	"glideDurationMs",
	"startHandle",
	"endHandle",
	"arcSize",
	"arcFlow",
	"spring",
	"turnRadius",
] as const;

/** Validates a motion config and fixes its property order, so equal configs compare and serialize equally. */
function normalizeMotion(config: CursorMotionConfig | undefined, source?: string): CursorMotionConfig | undefined {
	if (config === undefined) {
		return undefined;
	}
	return parseCursorMotion(
		Object.fromEntries(MOTION_KEYS.flatMap((key) => (config[key] === undefined ? [] : [[key, config[key]]]))),
		source,
	);
}

function withMotion<T extends object>(
	base: T,
	cursorMotion: CursorMotionConfig | undefined,
): T & Pick<Settings, "cursorMotion"> {
	return cursorMotion === undefined ? base : { ...base, cursorMotion };
}

function sameMotion(left: CursorMotionConfig | undefined, right: CursorMotionConfig | undefined): boolean {
	return JSON.stringify(normalizeMotion(left) ?? null) === JSON.stringify(normalizeMotion(right) ?? null);
}

function parseAllowList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter((id, index, all) => id !== "" && all.indexOf(id) === index);
}

/** What a server started with `env` would do, read with the server's own rules. */
function settingsFromEnv(env: EnvMap): Omit<Settings, "clients"> {
	const cursorMotion = normalizeMotion(cursorMotionFromEnvironment(env));
	return withMotion(
		{
			allowedApps: parseAllowList(env[ALLOW_ENV]),
			delivery: env[DELIVERY_ENV]?.trim().toLowerCase() === "attended" ? "attended" : "background",
			toolset: env[TOOLSET_ENV]?.trim().toLowerCase() === "lean" ? "lean" : "full",
			iphone: env[IPHONE_ENV]?.trim() === "1",
		},
		cursorMotion,
	);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((item) => right.includes(item));
}

/** Whether a registration's env already makes the server behave as `settings` say. */
export function envMatchesSettings(env: EnvMap, settings: Settings): boolean {
	let actual: Omit<Settings, "clients">;
	try {
		actual = settingsFromEnv(env);
	} catch (error) {
		if (error instanceof Error) {
			return false;
		}
		throw error;
	}
	return (
		sameSet(actual.allowedApps, settings.allowedApps) &&
		actual.delivery === settings.delivery &&
		actual.toolset === settings.toolset &&
		actual.iphone === settings.iphone &&
		sameMotion(actual.cursorMotion, settings.cursorMotion)
	);
}

/** The env a registration carries for `settings`; undefined removes a key. */
export function envForSettings(settings: Settings): EnvUpdate {
	const motion = normalizeMotion(settings.cursorMotion);
	return {
		[ALLOW_ENV]: settings.allowedApps.length === 0 ? undefined : settings.allowedApps.join(","),
		[DELIVERY_ENV]: settings.delivery,
		[TOOLSET_ENV]: settings.toolset,
		[IPHONE_ENV]: settings.iphone ? "1" : undefined,
		[CURSOR_MOTION_ENV]: motion === undefined ? undefined : JSON.stringify(motion),
	};
}

export function desiredRegistration(
	layout: Pick<Layout, "helperExecutable" | "server">,
	settings: Settings,
): DesiredRegistration {
	return {
		launch: { command: layout.helperExecutable, args: [layout.server] },
		env: envForSettings(settings),
		envSatisfied: (env) => envMatchesSettings(env, settings),
	};
}

// --- config.json ---------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDelivery(value: unknown): value is Delivery {
	return value === "background" || value === "attended";
}

function isToolset(value: unknown): value is Toolset {
	return value === "full" || value === "lean";
}

/** Reads config.json strictly: a value of the wrong type is an error naming the file and the key. */
export function parseSettings(text: string, path: string): Settings {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`${path} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`${path} must hold a JSON object`);
	}
	const invalid = (key: string, expected: string) => new Error(`${path}: "${key}" must be ${expected}`);
	const allowedApps = parsed["allowedApps"] ?? DEFAULT_SETTINGS.allowedApps;
	if (!isStringList(allowedApps)) {
		throw invalid("allowedApps", "a list of bundle ids");
	}
	const delivery = parsed["delivery"] ?? DEFAULT_SETTINGS.delivery;
	if (!isDelivery(delivery)) {
		throw invalid("delivery", '"background" or "attended"');
	}
	const toolset = parsed["toolset"] ?? DEFAULT_SETTINGS.toolset;
	if (!isToolset(toolset)) {
		throw invalid("toolset", '"full" or "lean"');
	}
	const iphone = parsed["iphone"] ?? DEFAULT_SETTINGS.iphone;
	if (typeof iphone !== "boolean") {
		throw invalid("iphone", "true or false");
	}
	const clients = parsed["clients"] ?? DEFAULT_SETTINGS.clients;
	if (!isStringList(clients) || !clients.every(isClientName)) {
		throw invalid("clients", `a list of ${CLIENT_NAMES.join(", ")}`);
	}
	const cursorMotion = normalizeMotion(parseCursorMotion(parsed["cursorMotion"], `${path}: "cursorMotion"`));
	return withMotion(
		{
			allowedApps: parseAllowList(allowedApps.join(",")),
			delivery,
			toolset,
			iphone,
			clients: CLIENT_NAMES.filter((name) => clients.includes(name)),
		},
		cursorMotion,
	);
}

export interface LoadedSettings {
	readonly settings: Settings;
	/** False when config.json does not exist yet (the settings are the defaults). */
	readonly saved: boolean;
}

export function loadSettings(path: string): LoadedSettings {
	if (!existsSync(path)) {
		return { settings: DEFAULT_SETTINGS, saved: false };
	}
	return { settings: parseSettings(readFileSync(path, "utf8"), path), saved: true };
}

/** Writes config.json atomically, readable by the user only. */
export function saveSettings(path: string, settings: Settings): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}`;
	const body = withMotion(
		{
			allowedApps: [...settings.allowedApps],
			delivery: settings.delivery,
			toolset: settings.toolset,
			iphone: settings.iphone,
		},
		normalizeMotion(settings.cursorMotion),
	);
	const saved = { ...body, clients: [...settings.clients] };
	writeFileSync(temporary, `${JSON.stringify(saved, null, "\t")}\n`, { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

export function sameSettings(left: Settings, right: Settings): boolean {
	return (
		left.allowedApps.join(",") === right.allowedApps.join(",") &&
		left.delivery === right.delivery &&
		left.toolset === right.toolset &&
		left.iphone === right.iphone &&
		sameMotion(left.cursorMotion, right.cursorMotion) &&
		left.clients.join(",") === right.clients.join(",")
	);
}

/**
 * Settings recovered from registrations that run this checkout, for a first run without config.json (an install
 * registered before config.json existed): the clients that run it, and the settings of the first one found.
 */
export function adoptRegistrations(layout: Pick<Layout, "checkout">, context: ClientContext): Settings | undefined {
	const clients: ClientName[] = [];
	let adopted: Omit<Settings, "clients"> | undefined;
	for (const client of ["omo", "codex", "claude"] as const) {
		const { entry } = readClientEntry(client, context);
		if (entry !== undefined && entryRunsCheckout(entry, layout.checkout)) {
			clients.push(client);
			adopted ??= settingsFromEnv(entry.env);
		}
	}
	return adopted === undefined ? undefined : { ...adopted, clients };
}

export interface ApplyOutcome {
	readonly changes: readonly ClientChange[];
	readonly failures: readonly { readonly client: ClientName; readonly error: string }[];
}

/** Registers `settings` with each client; one client failing does not stop the others. */
export function applyToClients(
	clients: readonly ClientName[],
	desired: DesiredRegistration,
	context: ClientContext,
): ApplyOutcome {
	const changes: ClientChange[] = [];
	const failures: { client: ClientName; error: string }[] = [];
	for (const client of clients) {
		try {
			changes.push(registerClient(client, desired, context));
		} catch (error) {
			failures.push({ client, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { changes, failures };
}

// --- Apps ----------------------------------------------------------------------------------------------------------

/** Resolves an app name (or a path to an .app) to its bundle id; undefined when no such app is found. */
export type AppResolver = (name: string) => string | undefined;

const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const APP_DIRECTORIES = [
	"/Applications",
	"/Applications/Utilities",
	"/System/Applications",
	"/System/Applications/Utilities",
	"/System/Library/CoreServices",
	"/System/Library/CoreServices/Applications",
];

/** com.apple.TextEdit is a bundle id; TextEdit.app is a file name, though com.example.App is an id again. */
export function looksLikeBundleId(value: string): boolean {
	return BUNDLE_ID.test(value) && (value.split(".").length > 2 || !/\.app$/i.test(value));
}

function bundleIdOf(app: string): string | undefined {
	const result = spawnSync(
		"/usr/bin/plutil",
		["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(app, "Contents/Info.plist")],
		{ encoding: "utf8" },
	);
	const id = result.status === 0 ? result.stdout.trim() : "";
	return id === "" ? undefined : id;
}

/** Looks for "<name>.app" in the usual application folders, then asks Spotlight. */
export function findAppBundleId(input: string, home: string): string | undefined {
	if (input.startsWith("/")) {
		return bundleIdOf(input);
	}
	const name = input.replace(/\.app$/i, "");
	const wanted = `${name}.app`.toLowerCase();
	for (const directory of [...APP_DIRECTORIES, join(home, "Applications")]) {
		let entries: string[];
		try {
			entries = readdirSync(directory);
		} catch {
			continue;
		}
		const match = entries.find((entry) => entry.toLowerCase() === wanted);
		const id = match === undefined ? undefined : bundleIdOf(join(directory, match));
		if (id !== undefined) {
			return id;
		}
	}
	const quoted = name.replace(/["\\]/g, "\\$&");
	const spotlight = spawnSync(
		"/usr/bin/mdfind",
		[
			`kMDItemContentType == "com.apple.application-bundle" && (kMDItemFSName == "${quoted}.app"c || kMDItemDisplayName == "${quoted}"c)`,
		],
		{ encoding: "utf8", timeout: 10_000 },
	);
	for (const path of (spotlight.stdout ?? "").split("\n")) {
		const id = path.trim() === "" ? undefined : bundleIdOf(path.trim());
		if (id !== undefined) {
			return id;
		}
	}
	return undefined;
}

/** Splits comma-separated names and bundle ids and resolves each name; `unknown` lists what matched no app. */
export function resolveApps(inputs: readonly string[], resolver: AppResolver): { ids: string[]; unknown: string[] } {
	const ids: string[] = [];
	const unknown: string[] = [];
	for (const item of inputs.flatMap((input) => input.split(",")).map((value) => value.trim())) {
		if (item === "") {
			continue;
		}
		const id = looksLikeBundleId(item) ? item : resolver(item);
		if (id === undefined) {
			unknown.push(item);
		} else if (!ids.includes(id)) {
			ids.push(id);
		}
	}
	return { ids, unknown };
}

export interface SettingsChange {
	readonly allow?: readonly string[] | undefined;
	readonly disallow?: readonly string[] | undefined;
	readonly delivery?: Delivery | undefined;
	readonly toolset?: Toolset | undefined;
	readonly iphone?: boolean | undefined;
	/** A config enables or replaces the motion; null disables it; undefined leaves it unchanged. */
	readonly cursorMotion?: CursorMotionConfig | null | undefined;
	readonly register?: readonly ClientName[] | undefined;
	readonly unregister?: readonly ClientName[] | undefined;
}

/**
 * `settings` with a change applied. Apps are given by name or bundle id; "all" in `disallow` clears the list. A
 * name that matches no app is reported in `unknown` and nothing else is applied for it.
 */
export function changeSettings(
	settings: Settings,
	change: SettingsChange,
	resolver: AppResolver,
): { settings: Settings; unknown: string[] } {
	const added = resolveApps(change.allow ?? [], resolver);
	const removeAll = (change.disallow ?? []).some((value) => value.trim().toLowerCase() === "all");
	const removed = resolveApps(
		(change.disallow ?? []).filter((value) => value.trim().toLowerCase() !== "all"),
		(name) => settings.allowedApps.find((id) => id.toLowerCase() === name.toLowerCase()) ?? resolver(name),
	);
	// Bundle ids are case-insensitive to LaunchServices, so withdrawing one is too.
	const withdrawn = removed.ids.map((id) => id.toLowerCase());
	const kept = removeAll ? [] : settings.allowedApps.filter((id) => !withdrawn.includes(id.toLowerCase()));
	const allowedApps = [...kept, ...added.ids.filter((id) => !kept.includes(id))];
	const unregister = change.unregister ?? [];
	const clients = CLIENT_NAMES.filter(
		(name) =>
			!unregister.includes(name) && (settings.clients.includes(name) || (change.register ?? []).includes(name)),
	);
	const cursorMotion =
		change.cursorMotion === undefined ? settings.cursorMotion : normalizeMotion(change.cursorMotion ?? undefined);
	return {
		settings: withMotion(
			{
				allowedApps,
				delivery: change.delivery ?? settings.delivery,
				toolset: change.toolset ?? settings.toolset,
				iphone: change.iphone ?? settings.iphone,
				clients,
			},
			cursorMotion,
		),
		unknown: [...added.unknown, ...removed.unknown],
	};
}

// --- The integration bundle ------------------------------------------------------------------------------------------

type BundleLayout = Pick<
	Layout,
	"checkout" | "helperExecutable" | "server" | "skillSource" | "serverPackage" | "bundleDir"
>;

function serverVersion(path: string): string {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const version =
			typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["version"] : undefined;
		return typeof version === "string" && version !== "" ? version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/** What the bundle is generated from: this checkout's helper, server, skill and version, and the saved settings. */
export function bundleInputs(layout: BundleLayout, settings: Settings): BundleInputs {
	let skill: BundleInputs["skill"];
	try {
		skill = readSkillFiles(layout.skillSource);
	} catch (error) {
		throw new Error(
			`cannot read the apple-cua skill at ${layout.skillSource} (${error instanceof Error ? error.message : String(error)}); re-run ./scripts/setup.sh in the checkout`,
		);
	}
	const env = Object.fromEntries(
		Object.entries(envForSettings(settings)).filter((pair): pair is [string, string] => pair[1] !== undefined),
	);
	return {
		checkout: layout.checkout,
		baseVersion: serverVersion(layout.serverPackage),
		launch: { command: layout.helperExecutable, args: [layout.server] },
		env,
		skill,
	};
}

/** The bundle these settings call for, planned but not written (the doctor compares against it). */
export function planSettingsBundle(layout: BundleLayout, settings: Settings): BundlePlan {
	return planBundle(bundleInputs(layout, settings));
}

/**
 * Writes the bundle for `settings` and returns the registration every client should get, carrying the bundle the
 * plugin clients install from. `explicit` marks a person's own --register, which may switch a disabled plugin back on.
 */
export function prepareRegistration(
	layout: BundleLayout,
	settings: Settings,
	explicit: boolean,
): { desired: DesiredRegistration; plan: BundlePlan; changed: boolean; previousCheckout: string | undefined } {
	const plan = planSettingsBundle(layout, settings);
	const written = writeBundle(layout.bundleDir, plan);
	return {
		desired: {
			...desiredRegistration(layout, settings),
			bundle: { bundleDir: layout.bundleDir, version: plan.version, checkout: layout.checkout },
			explicit,
		},
		plan,
		changed: written.changed,
		previousCheckout:
			written.previous !== undefined && written.previous.checkout !== layout.checkout
				? written.previous.checkout
				: undefined,
	};
}

/** The registration with the bundle these settings call for, without writing anything (for inspection). */
export function plannedRegistration(layout: BundleLayout, settings: Settings): DesiredRegistration {
	const plan = planSettingsBundle(layout, settings);
	return {
		...desiredRegistration(layout, settings),
		bundle: { bundleDir: layout.bundleDir, version: plan.version, checkout: layout.checkout },
	};
}
