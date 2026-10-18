import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BrowserBridge } from "./bridge.js";
import * as connection from "./connection.js";
import { createBrowserMcpServer, main } from "./server.js";

describe("browser MCP contract", () => {
	const cleanups: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const close of cleanups.splice(0)) await close();
		vi.restoreAllMocks();
	});

	it("#given connection publication fails #when starting MCP #then closes transports and releases the port", async () => {
		const failure = new Error("connection publication failed");
		vi.spyOn(connection, "connectionToken").mockResolvedValue("a".repeat(64));
		vi.spyOn(connection, "writeConnection").mockRejectedValue(failure);
		const listen = BrowserBridge.prototype.listen;
		const closeBridge = vi.spyOn(BrowserBridge.prototype, "close");
		let port = 0;
		vi.spyOn(BrowserBridge.prototype, "listen").mockImplementation(async function (this: BrowserBridge) {
			cleanups.push(async () => {
				if (!closeBridge.mock.contexts.includes(this)) await this.close();
			});
			port = await listen.call(this, 0);
			return port;
		});
		const closeServer = vi.spyOn(McpServer.prototype, "close");
		const closeTransport = vi.spyOn(StdioServerTransport.prototype, "close");
		await expect(main()).rejects.toBe(failure);
		expect(closeServer).toHaveResolved();
		expect(closeTransport).toHaveResolved();
		const probe = createServer();
		try {
			await new Promise<void>((resolve, reject) => {
				probe.once("error", reject);
				probe.listen(port, "127.0.0.1", resolve);
			});
		} finally {
			await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
		}
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
		await client.callTool({ name: "browser_space", arguments: { space: "known" } });
		const result = await client.callTool({
			name: "browser_observe",
			arguments: { space: "known", page: "p1" },
		});
		expect(result.isError).toBe(true);
		const content = z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(result.content);
		const item = content[0];
		if (item === undefined) throw new Error("Expected an error response");
		const error = z.object({ error: z.string() }).parse(JSON.parse(item.text));
		expect(error.error).toBe("stale");
	});
});
