import { StopSwitch, getSckitLoadError, isSckitAvailable, probeHostCapabilities } from "@apple-cua/core";
import type { HostCapabilities, StopStatusSource } from "@apple-cua/core";
import { capabilityReport } from "./capability-tools.js";
import { allowedBundleIdsFromProcessEnvironment, deliveryFromProcessEnvironment } from "./native-policy.js";
import { toolNamesFor } from "./tool-names.js";
import { resolveServerOptions } from "./toolset.js";

/** `server.js --doctor` prints one self-check report as JSON and exits instead of starting the MCP server. */
export const SELF_CHECK_FLAG = "--doctor";

export interface NativeCaptureStatus {
	readonly available: boolean;
	/** Why the native ScreenCaptureKit library cannot be used here; empty when it can. */
	readonly error: string;
}

export interface SelfCheckSources {
	readonly probeHost: () => HostCapabilities;
	readonly stop: StopStatusSource;
	readonly nativeCapture: () => NativeCaptureStatus;
}

/**
 * What this process may do on this Mac, read without raising a permission prompt: Accessibility and Screen
 * Recording come from AXIsProcessTrusted and CGPreflightScreenCaptureAccess, which only report. Launched through
 * the signed helper app, the answers describe the helper's identity ("apple-cua MCP"), the one MCP clients run the
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
	};
}

function nativeSelfCheckSources(): SelfCheckSources {
	return {
		probeHost: probeHostCapabilities,
		stop: new StopSwitch(),
		nativeCapture: () => ({ available: isSckitAvailable(), error: getSckitLoadError() }),
	};
}
