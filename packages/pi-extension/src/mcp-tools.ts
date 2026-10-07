import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "typebox";

import type { McpBridge } from "./mcp-bridge.js";
import { agentToolResult } from "./mcp-result.js";
import { type ToolDefinition, defineTool } from "./pi/index.js";

/**
 * One pi tool per apple-cua-mcp tool, with the server's own name, description and JSON Schema, so every guard stays
 * in the server. Calls run one at a time, as the server's harness guide asks of every client.
 */
export function mcpToolDefinitions(tools: readonly Tool[], bridge: Pick<McpBridge, "callTool">): ToolDefinition[] {
	return tools.map((tool) =>
		defineTool({
			name: tool.name,
			label: `apple-cua: ${tool.title ?? tool.annotations?.title ?? tool.name}`,
			description: tool.description ?? tool.name,
			parameters: Type.Unsafe<Record<string, unknown>>(parameterSchema(tool.inputSchema)),
			executionMode: "sequential",
			async execute(_toolCallId, params, signal, onUpdate) {
				const result = await bridge.callTool(tool.name, params, {
					signal,
					onProgress: (message) => onUpdate?.({ content: [{ type: "text", text: message }], details: undefined }),
				});
				return agentToolResult(result);
			},
		}),
	);
}

/** The input schema as pi hands it to providers: the server's JSON Schema without its $schema dialect marker. */
export function parameterSchema(schema: Tool["inputSchema"]): Record<string, unknown> {
	return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema"));
}
