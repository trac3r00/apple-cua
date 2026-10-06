import { spawnSync } from "node:child_process";
import {
	StopSwitch,
	automationPermission,
	getSckitLoadError,
	isSckitAvailable,
	probeHostCapabilities,
	requestAccessibility,
	requestScreenRecording,
} from "@apple-cua/core";
import type { AutomationStatus, HostCapabilities, StopStatusSource } from "@apple-cua/core";
import { capabilityReport } from "./capability-tools.js";
import { allowedBundleIdsFromProcessEnvironment, deliveryFromProcessEnvironment } from "./native-policy.js";
import { toolNamesFor } from "./tool-names.js";
import { resolveServerOptions } from "./toolset.js";

/** `server.js --doctor` prints one self-check report as JSON and exits instead of starting the MCP server. */
export const SELF_CHECK_FLAG = "--doctor";

/**
 * `server.js --request-permissions <kinds>` shows macOS's permission dialogs for the helper and prints what is
 * granted afterwards as JSON. Kinds, comma-separated: accessibility, screen-recording, automation:<bundle id>, and
 * automation-status:<bundle id>, which only reads.
 */
export const PERMISSION_REQUEST_FLAG = "--request-permissions";

/** The apps the server sends Apple Events to on its own: window lookup through System Events, desktop size from Finder. */
const AUTOMATION_TARGETS = ["com.apple.systemevents", "com.apple.finder"] as const;

const SYSTEM_EVENTS = "com.apple.systemevents";
const LAUNCH_WAIT_MS = 10_000;
const LAUNCH_POLL_MS = 200;

export interface NativeCaptureStatus {
	readonly available: boolean;
	/** Why the native ScreenCaptureKit library cannot be used here; empty when it can. */
	readonly error: string;
}

export interface SelfCheckSources {
	readonly probeHost: () => HostCapabilities;
	readonly stop: StopStatusSource;
	readonly nativeCapture: () => NativeCaptureStatus;
	/** Reads the Automation permission for an app without asking. */
	readonly automation: (bundleId: string) => AutomationStatus;
}

/**
 * What this process may do on this Mac, read without raising a permission prompt: Accessibility and Screen
 * Recording come from AXIsProcessTrusted and CGPreflightScreenCaptureAccess, which only report. Launched through
 * the signed helper app, the answers describe the helper's identity ("apple-cua-mcp"), the one MCP clients run the
 * server under, which is why `apple-cua doctor` reads its permissions from here rather than from its own process.
 */
export function selfCheckReport(sources: SelfCheckSources = nativeSelfCheckSources()): Record<string, unknown> {
	const { toolset, iphone } = resolveServerOptions();
	return {
		...capabilityReport({
			delivery: deliveryFromProcessEnvironment(),
			probeHost: sources.probeHost,
			allowedBundleIds: allowedBundleIdsFromProcessEnvironment(),
			stop: sources.stop,
			toolset,
			toolNames: toolNamesFor(toolset, iphone),
		}),
		process: { node: process.version, arch: process.arch, execPath: process.execPath, pid: process.pid },
		nativeCapture: sources.nativeCapture(),
		automation: Object.fromEntries(AUTOMATION_TARGETS.map((bundleId) => [bundleId, sources.automation(bundleId)])),
	};
}

export type PermissionRequest =
	| { readonly kind: "accessibility" }
	| { readonly kind: "screen-recording" }
	| { readonly kind: "automation"; readonly bundleId: string; readonly ask: boolean };

export function parsePermissionRequests(value: string): PermissionRequest[] {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item !== "")
		.map((item): PermissionRequest => {
			if (item === "accessibility" || item === "screen-recording") {
				return { kind: item };
			}
			const [prefix = "", ...rest] = item.split(":");
			const bundleId = rest.join(":").trim();
			if ((prefix !== "automation" && prefix !== "automation-status") || bundleId === "") {
				throw new Error(
					`unknown permission request "${item}" (accessibility, screen-recording, automation:<bundle id>, automation-status:<bundle id>)`,
				);
			}
			return { kind: "automation", bundleId, ask: prefix === "automation" };
		});
}

export interface PermissionRequestSources {
	readonly requestAccessibility: () => boolean;
	readonly requestScreenRecording: () => boolean;
	readonly automation: (bundleId: string, ask: boolean) => AutomationStatus;
	/** Starts System Events in the background; it has no window, and Automation can only be asked of a running app. */
	readonly launchSystemEvents: () => void;
	readonly pause: (milliseconds: number) => void;
}

export interface PermissionRequestReport {
	accessibility?: boolean;
	screenRecording?: boolean;
	automation?: Record<string, AutomationStatus>;
}

/** Asks for each permission in turn; an Automation dialog blocks until the person answers it. */
export function requestPermissions(
	requests: readonly PermissionRequest[],
	sources: PermissionRequestSources = nativePermissionRequestSources(),
): PermissionRequestReport {
	const report: PermissionRequestReport = {};
	for (const request of requests) {
		if (request.kind === "accessibility") {
			report.accessibility = sources.requestAccessibility();
		} else if (request.kind === "screen-recording") {
			report.screenRecording = sources.requestScreenRecording();
		} else {
			let status = sources.automation(request.bundleId, false);
			if (status === "not-running" && request.bundleId === SYSTEM_EVENTS) {
				sources.launchSystemEvents();
				for (let waited = 0; status === "not-running" && waited < LAUNCH_WAIT_MS; waited += LAUNCH_POLL_MS) {
					sources.pause(LAUNCH_POLL_MS);
					status = sources.automation(request.bundleId, false);
				}
			}
			if (status === "not-determined" && request.ask) {
				status = sources.automation(request.bundleId, true);
			}
			report.automation = { ...report.automation, [request.bundleId]: status };
		}
	}
	return report;
}

function nativePermissionRequestSources(): PermissionRequestSources {
	const sleeper = new Int32Array(new SharedArrayBuffer(4));
	return {
		requestAccessibility,
		requestScreenRecording,
		automation: automationPermission,
		launchSystemEvents: () => {
			spawnSync("/usr/bin/open", ["-g", "-j", "-b", SYSTEM_EVENTS], { stdio: "ignore" });
		},
		pause: (milliseconds) => {
			Atomics.wait(sleeper, 0, 0, milliseconds);
		},
	};
}

function nativeSelfCheckSources(): SelfCheckSources {
	return {
		probeHost: probeHostCapabilities,
		stop: new StopSwitch(),
		nativeCapture: () => ({ available: isSckitAvailable(), error: getSckitLoadError() }),
		automation: (bundleId) => automationPermission(bundleId, false),
	};
}
