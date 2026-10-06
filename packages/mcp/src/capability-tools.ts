import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostCapabilities, InputDelivery, StopStatus, StopStatusSource } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { SERVER_INFO } from "./server-info.js";
import { toolNamesFor } from "./tool-names.js";
import { textResult } from "./tool-result.js";
import type { ToolsetProfile } from "./toolset.js";

const STOP_CHORD = "Control+Option+Command (hold together)";
export const DEFAULT_SKILL_DIR = fileURLToPath(new URL("../../../skills/apple-cua/", import.meta.url));

export interface CapabilitySources {
	readonly delivery: InputDelivery | undefined;
	readonly probeHost: () => HostCapabilities;
	readonly allowedBundleIds: readonly string[];
	readonly stop?: StopStatusSource | undefined;
	/** The registered toolset profile; defaults to the full desktop set. */
	readonly toolset?: ToolsetProfile | undefined;
	/** Names of the tools this server registered; defaults to the full desktop set. */
	readonly toolNames?: readonly string[] | undefined;
}

type SessionMode = "console" | "remote" | "locked" | "unknown";

function sessionMode(host: HostCapabilities): SessionMode {
	if (host.session.screenLocked) {
		return "locked";
	}
	if (host.session.onConsole === undefined) {
		return "unknown";
	}
	return host.session.onConsole ? "console" : "remote";
}

function adviceFor(
	host: HostCapabilities,
	mode: SessionMode,
	allowed: readonly string[],
	stop: StopStatus | undefined,
): string[] {
	const advice: string[] = [];
	if (stop?.stopped === true) {
		advice.push(
			"The user stopped computer use. Do not act or retry; tell the user. Only they resume (apple-cua resume).",
		);
	}
	if (!host.permissions.accessibility) {
		advice.push(
			"Accessibility is not granted to the process that launched this server: no observation or input will work. Ask the user to grant it in System Settings > Privacy & Security > Accessibility, then restart the server.",
		);
	}
	if (!host.permissions.screenRecording) {
		advice.push(
			"Screen Recording is not granted: screenshots are unavailable, but accessibility observation and element actions still work.",
		);
	}
	if (allowed.length === 0) {
		advice.push("No app is approved for observation or input. The user sets APPLE_CUA_ALLOWED_BUNDLE_IDS.");
	}
	if (mode === "locked") {
		advice.push("The screen is locked: windows report no content. Use ask_user with reason screen_locked.");
	}
	if (mode === "remote") {
		advice.push(
			"This session is reached remotely while another user owns the console: Save/Open panels and some web content may not render. Prefer accessibility actions and report needs-user for steps that cannot be reached.",
		);
	}
	return advice;
}

export function capabilityReport(sources: CapabilitySources): Record<string, unknown> {
	const host = sources.probeHost();
	const mode = sessionMode(host);
	const stop = sources.stop?.status();
	const delivery = sources.delivery ?? "attended";
	const toolNames = sources.toolNames ?? toolNamesFor("full", false);
	return {
		server: {
			name: SERVER_INFO.name,
			version: SERVER_INFO.version,
			toolset: sources.toolset ?? "full",
			tools: toolNames.length,
		},
		platform: process.platform,
		backend: "macos-native",
		permissions: host.permissions,
		session: { ...host.session, mode },
		mainDisplay: host.mainDisplay,
		delivery: {
			mode: delivery,
			modes: ["background", "attended"],
			focusGuard:
				delivery === "background"
					? "input goes to the target window; the front app, its focused window and the pointer are left alone and restored if the target takes front"
					: "input may bring the target app forward",
		},
		approval: { allowedBundleIds: sources.allowedBundleIds },
		stop: {
			...(stop ?? { stopped: false }),
			armed: sources.stop !== undefined,
			chord: STOP_CHORD,
			resume: "apple-cua resume",
		},
		advice: adviceFor(host, mode, sources.allowedBundleIds, stop),
	};
}

export function registerCapabilityTools(server: McpServer, sources: CapabilitySources): void {
	server.registerTool(
		"get_capabilities",
		{
			description:
				"Read-only, one call: what this server can do on this Mac right now, without raising a permission prompt. Reports Accessibility and Screen Recording permission, whether the screen is locked and whether the session owns the console or is reached remotely, the main display size, the input delivery mode and its focus guarantee, which apps are approved, and whether the user has pressed the stop switch. advice lists what blocks work and what to tell the user. Call it first when a task fails for an unclear reason, before retrying.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async () => textResult(JSON.stringify(capabilityReport(sources))),
	);
}

export function registerSkillResources(server: McpServer, skillDir: string = DEFAULT_SKILL_DIR): readonly string[] {
	const skillPath = join(skillDir, "SKILL.md");
	if (!existsSync(skillPath)) {
		return [];
	}
	const files: { readonly uri: string; readonly path: string; readonly name: string }[] = [
		{ uri: "skill://apple-cua/SKILL.md", path: skillPath, name: "apple-cua-skill" },
	];
	const referencesDir = join(skillDir, "references");
	const references = existsSync(referencesDir) ? readdirSync(referencesDir).sort() : [];
	for (const entry of references.filter((name) => name.endsWith(".md"))) {
		files.push({
			uri: `skill://apple-cua/references/${entry}`,
			path: join(referencesDir, entry),
			name: `apple-cua-reference-${entry.slice(0, -3)}`,
		});
	}
	for (const file of files) {
		server.registerResource(
			file.name,
			file.uri,
			{ mimeType: "text/markdown", description: `apple-cua operating guide: ${file.uri.slice("skill://".length)}` },
			async (uri) => ({
				contents: [{ uri: uri.href, mimeType: "text/markdown", text: readFileSync(file.path, "utf8") }],
			}),
		);
	}
	return files.map((file) => file.uri);
}
