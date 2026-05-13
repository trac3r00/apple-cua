import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as MacPermissions from "node-mac-permissions";
import type { PermissionInterface, PermissionKind, PermissionStatus } from "./interface.js";

type MacPermissionName = "screen" | "accessibility" | "input-monitoring" | "apple-events";

type NativePermissionStatus = "not-determined" | "not determined" | "denied" | "authorized" | "restricted";

const DEFAULT_APPLE_EVENTS_BUNDLE_ID = "com.apple.Finder";
const execFileAsync = promisify(execFile);

export class MacOSPermissions implements PermissionInterface {
	async check(kind: PermissionKind): Promise<PermissionStatus> {
		const macPermissions = await importMacPermissions();
		return mapNativeStatus(getAuthStatus(macPermissions, toMacPermissionName(kind)));
	}

	async request(kind: PermissionKind, bundleId = DEFAULT_APPLE_EVENTS_BUNDLE_ID): Promise<void> {
		const macPermissions = await importMacPermissions();

		switch (kind) {
			case "screen":
				await Promise.resolve(macPermissions.askForScreenCaptureAccess());
				return;
			case "accessibility":
				await Promise.resolve(macPermissions.askForAccessibilityAccess());
				return;
			case "input-monitoring":
				await macPermissions.askForInputMonitoringAccess();
				return;
			case "apple-events":
				await requestAppleEventsAccess(macPermissions, bundleId);
				return;
		}
	}
}

function toMacPermissionName(kind: PermissionKind): MacPermissionName {
	switch (kind) {
		case "screen":
			return "screen";
		case "accessibility":
			return "accessibility";
		case "input-monitoring":
			return "input-monitoring";
		case "apple-events":
			return "apple-events";
	}
}

function mapNativeStatus(status: string): PermissionStatus {
	if (!isNativePermissionStatus(status)) {
		throw new Error(`Unknown macOS permission status: ${status}`);
	}

	switch (status) {
		case "not-determined":
		case "not determined":
			return "not-determined";
		case "denied":
			return "denied";
		case "authorized":
			return "authorized";
		case "restricted":
			return "restricted";
	}
}

async function importMacPermissions(): Promise<typeof MacPermissions> {
	const mod = (await import("node-mac-permissions")) as typeof MacPermissions & {
		readonly default?: typeof MacPermissions;
	};
	return mod.default ?? mod;
}

function getAuthStatus(macPermissions: typeof MacPermissions, kind: MacPermissionName): string {
	const status = getNativeAuthStatus(macPermissions, kind);
	if (typeof status !== "string") {
		throw new TypeError("Expected macOS permission status to be a string");
	}
	return status;
}

function getNativeAuthStatus(macPermissions: typeof MacPermissions, kind: MacPermissionName): unknown {
	try {
		return Reflect.apply(macPermissions.getAuthStatus, undefined, [kind]);
	} catch (error) {
		if (kind === "apple-events") {
			return "not-determined";
		}
		throw error;
	}
}

async function requestAppleEventsAccess(macPermissions: typeof MacPermissions, bundleId: string): Promise<void> {
	const nativeRequest = Reflect.get(macPermissions, "askForAppleEventsAccess");
	if (typeof nativeRequest === "function") {
		await Reflect.apply(nativeRequest, undefined, [bundleId]);
		return;
	}

	await execFileAsync("osascript", ["-e", `tell application id ${quoteAppleScriptString(bundleId)} to get name`]);
}

function quoteAppleScriptString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function isNativePermissionStatus(status: string): status is NativePermissionStatus {
	return (
		status === "not-determined" ||
		status === "not determined" ||
		status === "denied" ||
		status === "authorized" ||
		status === "restricted"
	);
}
