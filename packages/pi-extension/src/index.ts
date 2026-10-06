import path from "node:path";
import { fileURLToPath } from "node:url";

import { MacOSHostComputer } from "@apple-cua/core";
import { Type } from "typebox";

import {
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	type ComputerToolInput,
	addAnthropicComputerUseToPayload,
	buildCodexComputerUseSection,
	buildComputerUseSection,
	computerToolSchema,
	executeNativeComputerAction,
	supportsAnthropicNativeComputerUse,
} from "./anthropic-computer-use.js";
import { type DisplayConfig, resolveDisplayConfig } from "./computer-use/coords.js";
import {
	type OpenAIComputerAction,
	type OpenAIComputerActionBatch,
	addOpenAIComputerUseToPayload,
	executeOpenAIComputerAction,
	openaiComputerActionBatchSchema,
	openaiComputerToolSchema,
	sanitizeOpenAIComputerUsePayload,
} from "./openai-computer-use.js";
import { type AgentToolResult, type ExtensionAPI, defineTool } from "./pi/index.js";
import { registerAllTools } from "./tools/index.js";

interface ExtensionState {
	readonly computer: MacOSHostComputer;
	readonly display: DisplayConfig;
	readonly enabled: boolean;
}

type ComputerFallbackInput = ComputerToolInput | OpenAIComputerAction | OpenAIComputerActionBatch;

interface ComputerUseModel {
	readonly api?: string;
	readonly provider?: string;
	readonly baseUrl?: string;
	readonly id?: string;
}

const DISABLE_COMPUTER_USE_BETA_ENV = "APPLE_CUA_DISABLE_COMPUTER_USE_BETA";
const OPENAI_NATIVE_TRANSPORT_ENV = "APPLE_CUA_OPENAI_NATIVE_TRANSPORT";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDirectory, "..");
const skillPath = path.resolve(packageRoot, "../../skills/apple-cua/SKILL.md");
const computerFallbackToolSchema = Type.Union([
	computerToolSchema,
	openaiComputerToolSchema,
	openaiComputerActionBatchSchema,
]);

let state: ExtensionState | undefined;
let openAINativeTransportWarningEmitted = false;

export default function macosCuaExtension(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => {
		return { skillPaths: [skillPath] };
	});

	pi.on("session_start", async (_event, ctx) => {
		const computer = new MacOSHostComputer();
		const display = resolveDisplayConfig(await computer.getScreenSize());
		const enabled = !isOptedOut(process.env[DISABLE_COMPUTER_USE_BETA_ENV]);
		state = { computer, display, enabled };
		registerAllTools(pi, { computer });

		if (!enabled) {
			return;
		}

		pi.registerTool(
			defineTool({
				name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
				label: "Computer Use",
				description:
					"Native computer-use actions for Anthropic and OpenAI Responses: screenshots, pointer, keyboard, scroll, drag, type, and wait.",
				parameters: computerFallbackToolSchema,
				async execute(_toolCallId, params) {
					return executeComputerFallback(params, computer, display);
				},
			}),
		);
		syncComputerToolActivation(pi, ctx.model);
	});

	pi.on("model_select", (event) => {
		syncComputerToolActivation(pi, event.model);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (state === undefined || !state.enabled) {
			return event.payload;
		}
		const api = ctx.model?.api;
		if (api === "anthropic-messages") {
			return addAnthropicComputerUseToPayload(api, event.payload, state.display, ctx.model?.id);
		}
		if (api === "openai-responses") {
			const payload = sanitizeOpenAIComputerUsePayload(api, event.payload);
			if (shouldInjectOpenAINativeComputerUse(ctx.model)) {
				return addOpenAIComputerUseToPayload(api, payload, state.display);
			}
			return payload;
		}
		return sanitizeOpenAIComputerUsePayload(api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (state === undefined || !state.enabled) {
			return undefined;
		}
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}
		const computerPrompt = supportsAnthropicNativeComputerUse(ctx.model.id)
			? buildComputerUseSection(state.display.modelWidth, state.display.modelHeight)
			: buildCodexComputerUseSection();
		return {
			systemPrompt: `${event.systemPrompt}\n${computerPrompt}`,
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
	return isTruthyFlag(value);
}

function isTruthyFlag(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function syncComputerToolActivation(pi: ExtensionAPI, model: ComputerUseModel | undefined): void {
	if (state === undefined || !state.enabled) {
		return;
	}
	const activeTools = pi.getActiveTools();
	const shouldActivate =
		(model?.api === "anthropic-messages" && supportsAnthropicNativeComputerUse(model.id)) ||
		(model?.api === "openai-responses" && shouldInjectOpenAINativeComputerUse(model));
	if (shouldActivate) {
		if (!activeTools.includes(ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME)) {
			pi.setActiveTools([...activeTools, ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME]);
		}
		return;
	}
	if (activeTools.includes(ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME)) {
		pi.setActiveTools(activeTools.filter((toolName) => toolName !== ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME));
	}
}

/**
 * The OpenAI Responses transport shipped with pi-ai 0.73.1 parses only `function_call`
 * items and serializes every tool result as `function_call_output`, so a native
 * `computer_call` item never reaches this extension and its required
 * `computer_call_output` reply is never sent. Injecting `{type:"computer"}` therefore
 * produced an unrunnable loop, so the native path stays off until the transport carries
 * those items and an operator opts in.
 */
function shouldInjectOpenAINativeComputerUse(model: ComputerUseModel | undefined): boolean {
	if (model?.provider !== "openai") {
		return false;
	}
	if (!isDirectOpenAIEndpoint(model.baseUrl)) {
		return false;
	}
	if (isTruthyFlag(process.env[OPENAI_NATIVE_TRANSPORT_ENV])) {
		return true;
	}
	warnOpenAINativeTransportUnavailable(model.id);
	return false;
}

function isDirectOpenAIEndpoint(baseUrl: string | undefined): boolean {
	try {
		const hostname = new URL(baseUrl ?? "https://api.openai.com/v1").hostname.toLowerCase();
		return hostname === "api.openai.com";
	} catch {
		return false;
	}
}

function warnOpenAINativeTransportUnavailable(modelId: string | undefined): void {
	if (openAINativeTransportWarningEmitted) {
		return;
	}
	openAINativeTransportWarningEmitted = true;
	process.stderr.write(
		`apple-cua: keeping semantic tools for ${modelId ?? "this model"}; the installed pi-ai transport handles only function_call/function_call_output items, not computer_call/computer_call_output. ` +
			`Set ${OPENAI_NATIVE_TRANSPORT_ENV}=1 to force the native computer tool once the transport supports it.\n`,
	);
}

async function executeComputerFallback(
	params: ComputerFallbackInput,
	computer: MacOSHostComputer,
	display: DisplayConfig,
): Promise<AgentToolResult<undefined>> {
	if (isOpenAIComputerActionBatch(params)) {
		let result: AgentToolResult<undefined> | undefined;
		for (const action of params.actions) {
			result = await executeOpenAIComputerAction(action, computer, display);
		}
		if (result === undefined) {
			throw new Error("OpenAI computer action batch must include at least one action");
		}
		return result;
	}
	if (isOpenAIComputerAction(params)) {
		return executeOpenAIComputerAction(params, computer, display);
	}
	return executeNativeComputerAction(params, computer, display);
}

function isOpenAIComputerActionBatch(params: ComputerFallbackInput): params is OpenAIComputerActionBatch {
	return "actions" in params;
}

function isOpenAIComputerAction(params: ComputerFallbackInput): params is OpenAIComputerAction {
	return "type" in params;
}
