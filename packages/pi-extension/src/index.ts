import path from "node:path";
import { fileURLToPath } from "node:url";

import { MacOSHostComputer } from "@macos-cua/core";

import {
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	type DisplayConfig,
	addAnthropicComputerUseToPayload,
	buildComputerUseSection,
	computerToolSchema,
	executeNativeComputerAction,
} from "./anthropic-computer-use.js";
import { type ExtensionAPI, defineTool } from "./pi/index.js";
import { registerAllTools } from "./tools/index.js";

interface ExtensionState {
	readonly computer: MacOSHostComputer;
	readonly displayConfig: DisplayConfig;
	readonly enabled: boolean;
}

const DISABLE_COMPUTER_USE_BETA_ENV = "MACOS_CUA_DISABLE_COMPUTER_USE_BETA";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDirectory, "..");
const skillPath = path.resolve(packageRoot, "../../skills/macos-cua/SKILL.md");

let state: ExtensionState | undefined;

export default function macosCuaExtension(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => {
		return { skillPaths: [skillPath] };
	});

	pi.on("session_start", async () => {
		const computer = new MacOSHostComputer();
		const { width, height } = await computer.getScreenSize();
		const displayConfig = { width, height };
		const enabled = !isOptedOut(process.env[DISABLE_COMPUTER_USE_BETA_ENV]);
		state = { computer, displayConfig, enabled };
		registerAllTools(pi, { computer });

		if (!enabled) {
			return;
		}

		pi.registerTool(
			defineTool({
				name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
				label: "Computer Use",
				description:
					"Anthropic native actions: screenshot, key, type, mouse_move, left/right/middle click, double/triple click, left_click_drag, cursor_position, scroll, wait.",
				parameters: computerToolSchema,
				async execute(_toolCallId, params) {
					return executeNativeComputerAction(params, computer);
				},
			}),
		);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (state === undefined || !state.enabled) {
			return event.payload;
		}
		return addAnthropicComputerUseToPayload(ctx.model?.api, event.payload, state.displayConfig);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (state === undefined || !state.enabled) {
			return undefined;
		}
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}
		return {
			systemPrompt: `${event.systemPrompt}\n${buildComputerUseSection(state.displayConfig.width, state.displayConfig.height)}`,
		};
	});

	pi.on("session_shutdown", async () => {
		if (state === undefined) return;
		const { computer } = state;
		state = undefined;
		await computer.close();
	});
}

function isOptedOut(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
