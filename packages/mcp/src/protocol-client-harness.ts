import type { TopLevelWindow } from "@macos-cua/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import { createMcpServer } from "./server.js";

class InMemoryTransport implements Transport {
	peer: InMemoryTransport | undefined;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: <T extends JSONRPCMessage>(message: T) => void;

	async start(): Promise<void> {}

	async send(message: JSONRPCMessage): Promise<void> {
		const peer = this.peer;
		if (peer === undefined) {
			throw new Error("transport peer is not connected");
		}
		queueMicrotask(() => peer.onmessage?.(message));
	}

	async close(): Promise<void> {
		this.onclose?.();
	}
}

export async function createHarness(
	computer = new FakeGuardedComputer(),
	windowProbe?: () => Promise<readonly TopLevelWindow[]>,
) {
	const server = createMcpServer(computer, windowProbe);
	const client = new Client({ name: "context-first-test", version: "0.1.0" });
	const clientTransport = new InMemoryTransport();
	const serverTransport = new InMemoryTransport();
	clientTransport.peer = serverTransport;
	serverTransport.peer = clientTransport;
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
	return { client, computer, server, close: async () => await server.close() };
}

export function jsonText(result: unknown): string {
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		throw new Error("tool result content must be an array");
	}
	const text = [...result.content]
		.reverse()
		.find(
			(item): item is { readonly type: "text"; readonly text: string } =>
				typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item,
		);
	if (text === undefined) {
		throw new Error("tool result must contain JSON text");
	}
	return text.text;
}

export function jsonPayload(result: unknown): Record<string, unknown> {
	const parsed: unknown = JSON.parse(jsonText(result));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("tool JSON payload must be an object");
	}
	return Object.fromEntries(Object.entries(parsed));
}

export async function observe(harness: Awaited<ReturnType<typeof createHarness>>, app = "Finder"): Promise<string> {
	const result = await harness.client.callTool({ name: "get_app_state", arguments: { app } });
	const token = jsonPayload(result)["observation_token"];
	if (typeof token !== "string") {
		throw new Error("observation did not return a token");
	}
	return token;
}
