import { Value } from "typebox/value";
import { vi } from "vitest";

import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "../../src/pi/index.js";

type EventHandler = (...parameters: ReadonlyArray<unknown>) => unknown;

/** What a test needs of a registered tool: its published shape, and a call that validates like pi before executing. */
export interface RegisteredTool {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: unknown;
	readonly executionMode: string | undefined;
	readonly run: (params: unknown) => Promise<AgentToolResult<unknown>>;
}

export interface MockPi extends ExtensionAPI {
	readonly handlers: Map<string, EventHandler>;
	readonly tools: Map<string, RegisteredTool>;
	emit(eventName: string, event: unknown, context?: unknown): Promise<unknown>;
}

// Tools in these tests never read their context; pi's full ExtensionContext is out of reach of a unit test.
const toolContext = {} as ExtensionContext;

export function createMockPi(): MockPi {
	const handlers = new Map<string, EventHandler>();
	const tools = new Map<string, RegisteredTool>();
	const activeTools: string[] = [];
	// ExtensionAPI.on is one overload per event; a single recording implementation stands in for all of them.
	const on = ((eventName: string, handler: EventHandler) => {
		handlers.set(eventName, handler);
	}) as ExtensionAPI["on"];
	return {
		handlers,
		tools,
		on,
		async emit(eventName, event, context = {}) {
			const handler = handlers.get(eventName);
			if (handler === undefined) {
				throw new Error(`${eventName} handler missing`);
			}
			return await handler(event, context);
		},
		registerTool(tool) {
			tools.set(tool.name, {
				name: tool.name,
				label: tool.label,
				description: tool.description,
				parameters: tool.parameters,
				executionMode: tool.executionMode,
				run: async (params) => {
					if (!Value.Check(tool.parameters, params)) {
						throw new Error(`arguments do not match the ${tool.name} schema`);
					}
					return await tool.execute("call-1", params, undefined, undefined, toolContext);
				},
			});
			if (!activeTools.includes(tool.name)) {
				activeTools.push(tool.name);
			}
		},
		registerCommand() {},
		registerShortcut() {},
		registerFlag() {},
		getFlag() {
			return undefined;
		},
		registerMessageRenderer() {},
		sendMessage() {},
		sendUserMessage() {},
		appendEntry() {},
		setSessionName() {},
		getSessionName() {
			return undefined;
		},
		setLabel() {},
		exec: vi.fn<ExtensionAPI["exec"]>(),
		getActiveTools() {
			return [...activeTools];
		},
		getAllTools() {
			return [];
		},
		setActiveTools(toolNames) {
			activeTools.splice(0, activeTools.length, ...toolNames);
		},
		getCommands() {
			return [];
		},
		setModel: vi.fn<ExtensionAPI["setModel"]>().mockResolvedValue(false),
		getThinkingLevel: vi.fn<ExtensionAPI["getThinkingLevel"]>(),
		setThinkingLevel() {},
		registerProvider() {},
		unregisterProvider() {},
		events: {} as ExtensionAPI["events"],
	};
}
