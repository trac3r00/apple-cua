#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
	StopSwitch,
	currentSystemPrompts,
	probeHostCapabilities,
	readHidModifierFlags,
	spawnOpenLauncher,
	startStopChordDetector,
} from "@apple-cua/core";
import type {
	AppOpenLauncher,
	GuardedComputerInterface,
	StopStatusSource,
	SystemPrompt,
	WindowProbe,
} from "@apple-cua/core";
import { IPhoneMirroring } from "@apple-cua/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCapabilityTools, registerSkillResources } from "./capability-tools.js";
import { elementQueryFromInput, registerDesktopMutationTools } from "./desktop-mutation-tools.js";
import { GuardedSession } from "./guarded-session.js";
import { registerHumanTools } from "./human-tools.js";
import {
	allowedBundleIdsFromProcessEnvironment,
	createNativeComputer,
	createNativeWindowProbe,
} from "./native-policy.js";
import { registerParallelTools } from "./parallel-tools.js";
import { PhoneGuardSession, type PhoneToolSource } from "./phone-session.js";
import { registerPhoneTools } from "./phone-tools.js";
import { registerPowerTools } from "./power-tools.js";
import { registerScriptTools } from "./script-tools.js";
import { SERVER_INFO } from "./server-info.js";
import { toolNamesFor } from "./tool-names.js";
import {
	emptySchema,
	findElementsSchema,
	getAppStateSchema,
	openAppSchema,
	verifyStateSchema,
} from "./tool-schemas.js";
import { type McpServerOptions, type ToolsetProfile, resolveServerOptions, serverInstructionsFor } from "./toolset.js";

export { FULL_ONLY_TOOL_NAMES, IPHONE_TOOL_NAMES, LEAN_TOOL_NAMES, TOOL_NAMES, toolNamesFor } from "./tool-names.js";
export type { McpServerOptions, ToolsetProfile } from "./toolset.js";

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false } as const;
const MUTATION_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true } as const;

class ComputerMcpServer extends McpServer {
	constructor(
		private readonly session: GuardedSession,
		private readonly stopChord: { stop(): void } | undefined,
		toolset: ToolsetProfile,
	) {
		super(SERVER_INFO, { instructions: serverInstructionsFor(toolset) });
		this.server.onclose = () => {
			this.stopChord?.stop();
			this.session.close().catch((error: unknown) => {
				const details = error instanceof Error ? error.message : String(error);
				process.stderr.write(`Failed to close macOS computer session: ${details}\n`);
			});
		};
	}

	override async close(): Promise<void> {
		this.stopChord?.stop();
		this.session.invalidate();
		await super.close();
		await this.session.close();
	}
}

export function createMcpServer(
	computer: GuardedComputerInterface | undefined = undefined,
	windowProbe?: WindowProbe,
	phoneSource?: PhoneToolSource,
	appLauncher?: AppOpenLauncher,
	systemPromptProbe?: () => readonly SystemPrompt[],
	stopSwitch?: StopStatusSource,
	options?: McpServerOptions,
): McpServer {
	const { toolset, iphone } = resolveServerOptions(options);
	const resolvedComputer = computer ?? createNativeComputer();
	// Natively, the machine-wide file-backed stop switch plus the keyboard chord that flips it; tests inject their own.
	const nativeStopSwitch = computer === undefined && stopSwitch === undefined ? new StopSwitch() : undefined;
	const stopGate = stopSwitch ?? nativeStopSwitch;
	const stopChord =
		nativeStopSwitch === undefined ? undefined : startStopChordDetector(nativeStopSwitch, readHidModifierFlags);
	const session = new GuardedSession(
		resolvedComputer,
		windowProbe ?? (computer === undefined ? createNativeWindowProbe() : undefined),
		appLauncher ??
			(computer === undefined
				? spawnOpenLauncher({ background: resolvedComputer.delivery === "background" })
				: undefined),
		systemPromptProbe ?? (computer === undefined ? currentSystemPrompts : undefined),
		stopGate,
	);
	const server = new ComputerMcpServer(session, stopChord, toolset);

	server.registerTool(
		"verify_state",
		{
			description:
				"Read-only check of what an app's accessibility tree says now (fresh read, no screenshot); needs the observation_token from the latest observation or mutation. Each check answers verified true/false with the actual value: element_index alone confirms it exists, exists=false that it disappeared, value/label compare text. window_title checks an open window of the app. timeout_ms polls until every check passes or the deadline, the honest way to wait for a slow change. False means the expectation does not hold yet, not a silent failure: read the actual values and decide.",
			inputSchema: verifyStateSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async (input) =>
			await session.verify(input.observation_token, input.app, {
				...(input.checks === undefined ? {} : { checks: input.checks }),
				...(input.window_title === undefined ? {} : { windowTitle: input.window_title }),
				...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
			}),
	);

	server.registerTool(
		"list_apps",
		{
			description:
				"List running apps. Inventory is available even when no app is approved for observation or input; listing an app authorizes nothing.",
			inputSchema: emptySchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async () => await session.listApps(),
	);

	server.registerTool(
		"open_app",
		{
			description:
				"Open an app the way a person means it: bring it forward if running, launch it if not, and wait until it is observable. Answers launched and activated with the pid and bundle id. Authorizes no observation or input, so follow with get_app_state or find_elements; fails honestly if the app never becomes observable. Launching is the only way to reach an app this driver cannot observe yet.",
			inputSchema: openAppSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.openApp({
				name: input.name,
				...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
			}),
	);

	server.registerTool(
		"list_windows",
		{
			description:
				"List the on-screen top-level windows: window id, owning pid, app name, title, bounds in screen points. Use it to see what is open, pick the window for a coordinate action and check geometry before set_window_frame; empty means no window is on screen. Authorizes nothing.",
			inputSchema: emptySchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async () => await session.listWindows(),
	);

	server.registerTool(
		"get_app_state",
		{
			description:
				'Read-only observation of one approved app window: screenshot, accessibility elements with ids, input context. The only source of a first observation_token (one-use, per call; proves app, window and viewport were observed before input). diff_only=true returns only what changed since the previous observation (axChanges); the first observation is always the full tree. Diffs cap at 25 per bucket (axChangesOmitted counts the rest; element_format=json keeps all). include_screenshot=false skips the image (cheapest way to re-index elements); include_accessibility_tree=false skips the tree and returns only the window image, with no elements and no token. window_id (from windowCandidates or list_windows) observes a specific window instead of the focused one. settle_ms caps the pre-capture settle wait (0 skips it), max_elements caps big trees, subtree_of=<element id> observes just that subtree with ids restarting at 0, include_menu_bar=true adds menu-bar items. element_format="table" sends each element as a tab-separated row (element_rows under element_columns: id, role, label, value, frame, actions, children), about a fifth of the size; prefer it when reading elements yourself. Element ids are the element_index values every mutation tool accepts.',
			inputSchema: getAppStateSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async ({
			app,
			diff_only,
			include_screenshot,
			include_accessibility_tree,
			window_id,
			settle_ms,
			max_elements,
			include_menu_bar,
			subtree_of,
			element_format,
		}) =>
			await session.observe({
				app,
				diffOnly: diff_only === true,
				...(include_screenshot === undefined ? {} : { includeScreenshot: include_screenshot }),
				...(include_accessibility_tree === undefined
					? {}
					: { includeAccessibilityTree: include_accessibility_tree }),
				...(window_id === undefined ? {} : { windowId: window_id }),
				...(settle_ms === undefined ? {} : { settleMs: settle_ms }),
				...(max_elements === undefined ? {} : { maxElements: max_elements }),
				...(include_menu_bar === undefined ? {} : { includeMenuBar: include_menu_bar }),
				...(subtree_of === undefined ? {} : { subtreeOf: subtree_of }),
				...(element_format === undefined ? {} : { elementFormat: element_format }),
			}),
	);

	server.registerTool(
		"find_elements",
		{
			description:
				"Read-only described-element query: resolves a role, label or text to element ids without spreading the whole tree. Every query field must hold (role ignores AX prefix and case, label collapses whitespace, label_contains/value_contains/text are case-insensitive substrings); matches are ranked best first with matched_by evidence and element_index. Answers with the one-use observation_token for those ids, so a click can follow immediately; found=false lists near misses. No screenshot unless include_screenshot=true.",
			inputSchema: findElementsSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async (input) =>
			await session.findElements({
				app: input.app,
				query: elementQueryFromInput(input.query),
				...(input.window_id === undefined ? {} : { windowId: input.window_id }),
				...(input.max_results === undefined ? {} : { maxResults: input.max_results }),
				...(input.max_elements === undefined ? {} : { maxElements: input.max_elements }),
				...(input.include_screenshot === undefined ? {} : { includeScreenshot: input.include_screenshot }),
			}),
	);

	if (toolset === "full") {
		registerDesktopMutationTools(server, session, resolvedComputer);
		registerPowerTools(server, session, resolvedComputer);
		registerParallelTools(server, session, resolvedComputer);
	}
	registerHumanTools(server, session);
	registerScriptTools(server, session, resolvedComputer);
	registerCapabilityTools(server, {
		delivery: resolvedComputer.delivery,
		probeHost: probeHostCapabilities,
		allowedBundleIds: allowedBundleIdsFromProcessEnvironment(),
		stop: stopGate,
		toolset,
		toolNames: toolNamesFor(toolset, iphone),
	});
	registerSkillResources(server);
	if (iphone) {
		// Constructed only on opt-in so a desktop-only server never touches iPhone Mirroring.
		const phone = phoneSource ?? new IPhoneMirroring();
		registerPhoneTools(
			server,
			new PhoneGuardSession(phone, { ...(stopGate === undefined ? {} : { stopSwitch: stopGate }) }),
			phone,
		);
	}
	return server;
}

export async function main(): Promise<void> {
	const server = createMcpServer();
	exitOnTerminationSignals();
	await server.connect(new StdioServerTransport());
}

/**
 * End the process through process.exit on a termination signal, which runs exit hooks the default signal
 * handling skips: an app that background input told it is active is told otherwise on the way out.
 */
function exitOnTerminationSignals(): void {
	const exitCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
	for (const [signal, code] of Object.entries(exitCodes)) {
		process.once(signal, () => process.exit(code));
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`Fatal error: ${details}\n`);
		process.exit(1);
	});
}
