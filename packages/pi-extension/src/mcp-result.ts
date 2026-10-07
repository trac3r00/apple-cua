import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";

import type { AgentToolResult } from "./pi/index.js";

type PiContent = AgentToolResult<undefined>["content"][number];

/**
 * A tools/call answer as a pi tool result: text and images pass through in order. A refusal (isError) is thrown,
 * because pi tools report failure by throwing; its text becomes the error the model reads.
 */
export function agentToolResult(result: CallToolResult): AgentToolResult<undefined> {
	const content = result.content.map(piContent);
	if (result.isError === true) {
		const text = content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
		throw new Error(text === "" ? "apple-cua-mcp refused the call without saying why" : text);
	}
	if (content.length > 0) {
		return { content, details: undefined };
	}
	const text = result.structuredContent === undefined ? "(no content)" : JSON.stringify(result.structuredContent);
	return { content: [{ type: "text", text }], details: undefined };
}

/** The first text item of an answer parsed as a JSON object: where apple-cua-mcp puts state, tokens and reasons. */
export function resultPayload(result: CallToolResult): Readonly<Record<string, unknown>> | undefined {
	const first = result.content.find((item) => item.type === "text");
	if (first === undefined || first.type !== "text") {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(first.text);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? Object.fromEntries(Object.entries(parsed))
			: undefined;
	} catch {
		return undefined;
	}
}

/** pi results carry text and images only, so other MCP content is named in text rather than dropped. */
function piContent(block: ContentBlock): PiContent {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text };
		case "image":
			return { type: "image", data: block.data, mimeType: block.mimeType };
		case "audio":
			return {
				type: "text",
				text: `[audio content (${block.mimeType}) omitted: pi tool results carry text and images]`,
			};
		case "resource":
			return "text" in block.resource
				? { type: "text", text: block.resource.text }
				: {
						type: "text",
						text: `[binary resource ${block.resource.uri} omitted: pi tool results carry text and images]`,
					};
		case "resource_link":
			return {
				type: "text",
				text: `[resource ${block.uri}${block.description === undefined ? "" : `: ${block.description}`}]`,
			};
	}
}
