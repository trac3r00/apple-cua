import path from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "typebox";

import {
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	type ComputerToolInput,
	addAnthropicComputerUseToPayload,
	buildComputerUseSection,
	computerToolSchema,
	executeNativeComputerAction,
	supportsAnthropicNativeComputerUse,
} from "./anthropic-computer-use.js";
import { McpComputer, ObservedTarget } from "./computer-use/mcp-computer.js";
import { type Environment, resolveServerLaunch } from "./launcher.js";
import { type ConnectServer, McpBridge, connectStdio } from "./mcp-bridge.js";
import { mcpToolDefinitions } from "./mcp-tools.js";
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

export interface ExtensionOptions {
	/** Opens one connection to apple-cua-mcp; defaults to the resolved launcher over stdio. */
	readonly connect?: ConnectServer;
	/** Where APPLE_CUA_* settings and launcher overrides are read; defaults to process.env. */
	readonly env?: Environment;
}

interface Session {
	readonly bridge: McpBridge;
	readonly computer: McpComputer;
	readonly instructions: string | undefined;
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

let openAINativeTransportWarningEmitted = false;

export default function macosCuaExtension(pi: ExtensionAPI): void {
	installExtension(pi, {});
}

/** The extension with its server connection and environment supplied, for embedding and tests. */
export function createMacosCuaExtension(options: ExtensionOptions): (pi: ExtensionAPI) => void {
	return (pi) => installExtension(pi, options);
}

function installExtension(pi: ExtensionAPI, options: ExtensionOptions): void {
	const env = options.env ?? process.env;
	// Resolved on every connect, so the bundle is read at session start and a settings change reaches the next session.
	const connect = options.connect ?? (() => connectStdio(resolveServerLaunch(env, packageRoot)));
	let session: Session | undefined;

	pi.on("resources_discover", async () => {
		return { skillPaths: [skillPath] };
	});

	pi.on("session_start", async (_event, ctx) => {
		const previous = session;
		session = undefined;
		await previous?.bridge.close();

		const target = new ObservedTarget();
		const bridge = new McpBridge(connect);
		bridge.onToolResult((_name, args, result) => target.record(args, result));
		bridge.onServerExit(() => target.forgetToken());
		const { tools, instructions } = await bridge.start();
		for (const tool of mcpToolDefinitions(tools, bridge)) {
			pi.registerTool(tool);
		}
		const computer = new McpComputer((name, args) => bridge.callTool(name, args), target);
		const enabled = !isTruthyFlag(env[DISABLE_COMPUTER_USE_BETA_ENV]);
		session = { bridge, computer, instructions, enabled };
		if (!enabled) {
			return;
		}

		pi.registerTool(
			defineTool({
				name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
				label: "Computer Use",
				description:
					"Native computer-use actions for Anthropic and OpenAI Responses on the app window last observed with get_app_state: screenshot, click, drag, type, key and wait, each sent to apple-cua-mcp as a guarded call.",
				parameters: computerFallbackToolSchema,
				executionMode: "sequential",
				async execute(_toolCallId, params) {
					return executeComputerFallback(params, computer);
				},
			}),
		);
		syncComputerToolActivation(pi, ctx.model, env);
	});

	pi.on("model_select", (event) => {
		if (session?.enabled === true) {
			syncComputerToolActivation(pi, event.model, env);
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (session === undefined || !session.enabled) {
			return event.payload;
		}
		const api = ctx.model?.api;
		if (api === "anthropic-messages") {
			return addAnthropicComputerUseToPayload(api, event.payload, session.computer.display(), ctx.model?.id);
		}
		if (api === "openai-responses") {
			const payload = sanitizeOpenAIComputerUsePayload(api, event.payload);
			if (shouldInjectOpenAINativeComputerUse(ctx.model, env)) {
				return addOpenAIComputerUseToPayload(api, payload, session.computer.display());
			}
			return payload;
		}
		return sanitizeOpenAIComputerUsePayload(api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (session === undefined) {
			return undefined;
		}
		// An MCP client hands the server's instructions to the model; pi has no MCP client, so the bridge does.
		const sections =
			session.instructions === undefined || session.instructions.trim() === ""
				? []
				: [`## apple-cua\n${session.instructions.trim()}\n`];
		if (
			session.enabled &&
			ctx.model?.api === "anthropic-messages" &&
			supportsAnthropicNativeComputerUse(ctx.model.id)
		) {
			sections.push(buildComputerUseSection());
		}
		return sections.length === 0 ? undefined : { systemPrompt: `${event.systemPrompt}\n${sections.join("\n")}` };
	});

	pi.on("session_shutdown", async () => {
		const ending = session;
		session = undefined;
		await ending?.bridge.close();
	});
}

function isTruthyFlag(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function syncComputerToolActivation(pi: ExtensionAPI, model: ComputerUseModel | undefined, env: Environment): void {
	const activeTools = pi.getActiveTools();
	const shouldActivate =
		(model?.api === "anthropic-messages" && supportsAnthropicNativeComputerUse(model.id)) ||
		(model?.api === "openai-responses" && shouldInjectOpenAINativeComputerUse(model, env));
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
function shouldInjectOpenAINativeComputerUse(model: ComputerUseModel | undefined, env: Environment): boolean {
	if (model?.provider !== "openai") {
		return false;
	}
	if (!isDirectOpenAIEndpoint(model.baseUrl)) {
		return false;
	}
	if (isTruthyFlag(env[OPENAI_NATIVE_TRANSPORT_ENV])) {
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
	computer: McpComputer,
): Promise<AgentToolResult<undefined>> {
	if (isOpenAIComputerActionBatch(params)) {
		let result: AgentToolResult<undefined> | undefined;
		for (const action of params.actions) {
			result = await executeOpenAIComputerAction(action, computer);
		}
		if (result === undefined) {
			throw new Error("OpenAI computer action batch must include at least one action");
		}
		return result;
	}
	if (isOpenAIComputerAction(params)) {
		return executeOpenAIComputerAction(params, computer);
	}
	return executeNativeComputerAction(params, computer);
}

function isOpenAIComputerActionBatch(params: ComputerFallbackInput): params is OpenAIComputerActionBatch {
	return "actions" in params;
}

function isOpenAIComputerAction(params: ComputerFallbackInput): params is OpenAIComputerAction {
	return "type" in params;
}
