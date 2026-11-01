import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Retry = "safe" | "unsafe" | "never";

function errorMetadata(
	payload: Record<string, unknown>,
	message: string,
): {
	readonly code: string;
	readonly retry: Retry;
	readonly suggestion: string;
} {
	const reason = payload["reason"];
	const dispatched = payload["actionDispatched"] === true;
	if (dispatched) {
		return {
			code: "POST_ACTION_ERROR",
			retry: "unsafe",
			suggestion: "Input may already have been delivered. Observe and verify the outcome before sending more input.",
		};
	}
	if (
		reason === "stale-observation-token" ||
		reason === "observation-replaced" ||
		reason === "element-not-observed" ||
		reason === "token-observation-mismatch" ||
		message.startsWith("STALE_REF:") ||
		message.includes("observation token is missing, stale") ||
		message.includes("not the observed control")
	) {
		return {
			code: "STALE_REF",
			retry: "safe",
			suggestion: "Observe the app again and use only that snapshot's refs and token.",
		};
	}
	if (
		reason === "user-stopped" ||
		reason === "screen-locked" ||
		reason === "app-not-approved" ||
		reason === "url-blocked"
	) {
		return {
			code: reason.toUpperCase().replaceAll("-", "_"),
			retry: "never",
			suggestion: "Ask the user to resolve the refusal. Do not retry input automatically.",
		};
	}
	if (
		message.includes("Invalid arguments") ||
		message.includes("Invalid params") ||
		message.includes("MCP error -32602")
	) {
		return {
			code: "INVALID_ARGUMENT",
			retry: "never",
			suggestion: "Read the tool schema and correct the arguments before calling again.",
		};
	}
	if (reason !== undefined && typeof reason === "string") {
		return {
			code: reason.toUpperCase().replaceAll("-", "_"),
			retry: dispatched ? "unsafe" : "safe",
			suggestion: "Observe the target app again and resolve the refusal before retrying.",
		};
	}
	return {
		code: "TOOL_ERROR",
		retry: "unsafe",
		suggestion: "Observe and verify the target before retrying; the operation's delivery status is unknown.",
	};
}

/** Add machine-readable failure fields without replacing legacy error, reason, or evidence fields. */
export function normalizeToolError(result: CallToolResult): CallToolResult {
	let payload: Record<string, unknown> = {};
	let payloadIndex = -1;
	let message = "Tool failed without error details.";
	for (let index = result.content.length - 1; index >= 0; index--) {
		const item = result.content[index];
		if (item?.type !== "text") continue;
		message = item.text.trim() || message;
		try {
			const parsed: unknown = JSON.parse(item.text);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				payload = Object.fromEntries(Object.entries(parsed));
				payloadIndex = index;
				const detail = payload["error"] ?? payload["message"];
				if (typeof detail === "string") message = detail;
			}
		} catch {
			// SDK validation errors are plain text rather than JSON.
		}
		break;
	}
	if (result.isError !== true && payload["observationStatus"] !== "error") return result;
	const metadata = errorMetadata(payload, message);
	const content = [...result.content];
	const text = {
		type: "text" as const,
		text: JSON.stringify({
			...payload,
			ok: false,
			...(payloadIndex === -1 ? { error: message } : {}),
			...metadata,
			disposition: { retry: metadata.retry },
		}),
	};
	if (payloadIndex === -1) content.push(text);
	else content[payloadIndex] = text;
	return { ...result, isError: true, content };
}

/** Wrap the protocol boundary, including SDK argument validation and unknown-tool errors. */
export function installToolErrorEnvelope(server: McpServer): void {
	const original = server.server.setRequestHandler.bind(server.server);
	server.server.setRequestHandler = (schema, handler) =>
		original(schema, async (request, extra) => {
			const result = await handler(request, extra);
			if (request.method !== "tools/call") return result;
			const parsed = CallToolResultSchema.safeParse(result);
			return parsed.success ? { ...result, ...normalizeToolError(parsed.data) } : result;
		});
}
