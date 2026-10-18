import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { BrowserBridge } from "./bridge.js";
import { createBrowserMcpServer } from "./server.js";

describe("browser MCP contract", () => {
	const cleanups: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const close of cleanups.splice(0)) await close();
	});

	async function harness() {
		const bridge = new BrowserBridge({ status: () => ({ stopped: false }) });
		await bridge.listen(0);
		const server = createBrowserMcpServer(bridge);
		const client = new Client({ name: "browser-test", version: "1" });
		const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		cleanups.push(async () => {
			await client.close();
			await server.close();
			await bridge.close();
		});
		return client;
	}

	it("#given the browser server #when listing tools #then exposes only the bounded browser surface", async () => {
		const client = await harness();
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
			"browser_close",
			"browser_finish",
			"browser_observe",
			"browser_open",
			"browser_run",
			"browser_space",
			"browser_status",
		]);
	});

	it("#given no paired extension #when checking status #then reports disconnected without input", async () => {
		const client = await harness();
		await client.callTool({ name: "browser_space", arguments: { space: "shared-test" } });
		const result = await client.callTool({ name: "browser_status", arguments: {} });
		const content = z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(result.content);
		const item = content[0];
		if (item === undefined) throw new Error("Expected a status response");
		const status = z
			.object({
				connected: z.boolean(),
				stopped: z.boolean(),
				spaces: z.array(z.object({ space: z.string(), pages: z.array(z.string()) })),
			})
			.parse(JSON.parse(item.text));
		expect(status).toEqual({ connected: false, stopped: false, spaces: [{ space: "shared-test", pages: [] }] });
	});

	it("#given an unowned tab #when requesting observation #then returns a stale error through MCP", async () => {
		const client = await harness();
		const result = await client.callTool({
			name: "browser_observe",
			arguments: { space: "missing", page: "p1" },
		});
		expect(result.isError).toBe(true);
		const content = z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(result.content);
		const item = content[0];
		if (item === undefined) throw new Error("Expected an error response");
		const error = z.object({ error: z.string() }).parse(JSON.parse(item.text));
		expect(error.error).toBe("stale");
	});
});
