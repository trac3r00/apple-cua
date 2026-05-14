import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOL_NAMES, createMcpServer } from "./server.js";

const mockedComputer = vi.hoisted(() => ({
	capabilities: {
		supportsScreenshot: true,
		supportsInput: true,
		supportsAccessibility: true,
		supportsClipboard: true,
	},
	screenshot: vi.fn(),
	move: vi.fn(),
	click: vi.fn(),
	rightClick: vi.fn(),
	middleClick: vi.fn(),
	doubleClick: vi.fn(),
	type: vi.fn(),
	key: vi.fn(),
	scroll: vi.fn(),
	drag: vi.fn(),
	getCursorPosition: vi.fn(),
	getScreenSize: vi.fn(),
	close: vi.fn(),
}));

vi.mock("@macos-cua/core", () => ({
	MacOSHostComputer: vi.fn(() => mockedComputer),
}));

class InMemoryTransport implements Transport {
	peer: InMemoryTransport | null = null;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: <T extends JSONRPCMessage>(message: T) => void;

	async start(): Promise<void> {}

	async send(message: JSONRPCMessage): Promise<void> {
		const peer = this.peer;
		if (!peer) {
			throw new Error("Transport peer is not connected");
		}

		queueMicrotask(() => {
			peer.onmessage?.(message);
		});
	}

	async close(): Promise<void> {
		this.onclose?.();
	}
}

function createTransportPair(): readonly [InMemoryTransport, InMemoryTransport] {
	const clientTransport = new InMemoryTransport();
	const serverTransport = new InMemoryTransport();
	clientTransport.peer = serverTransport;
	serverTransport.peer = clientTransport;
	return [clientTransport, serverTransport];
}

async function createHarness(): Promise<{ client: Client; close: () => Promise<void> }> {
	const server = createMcpServer();
	const client = new Client({ name: "macos-cua-test", version: "0.1.0" });
	const [clientTransport, serverTransport] = createTransportPair();

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	return {
		client,
		close: async () => {
			await Promise.all([client.close(), server.close()]);
		},
	};
}

let closeHarness: (() => Promise<void>) | null = null;

beforeEach(() => {
	mockedComputer.screenshot.mockResolvedValue({
		data: Buffer.from("png-bytes"),
		mimeType: "image/png",
		width: 1920,
		height: 1080,
	});
	mockedComputer.move.mockResolvedValue(undefined);
	mockedComputer.click.mockResolvedValue(undefined);
	mockedComputer.rightClick.mockResolvedValue(undefined);
	mockedComputer.middleClick.mockResolvedValue(undefined);
	mockedComputer.doubleClick.mockResolvedValue(undefined);
	mockedComputer.type.mockResolvedValue(undefined);
	mockedComputer.key.mockResolvedValue(undefined);
	mockedComputer.scroll.mockResolvedValue(undefined);
	mockedComputer.drag.mockResolvedValue(undefined);
	mockedComputer.getCursorPosition.mockResolvedValue({ x: 10, y: 20 });
	mockedComputer.getScreenSize.mockResolvedValue({ width: 1920, height: 1080 });
});

afterEach(async () => {
	if (closeHarness) {
		await closeHarness();
		closeHarness = null;
	}
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("MCP server tools #given #when #then", () => {
	it("lists every expected computer-use and macOS extra tool", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		const result = await client.listTools();
		const toolNames = result.tools.map((tool) => tool.name).sort();

		// then
		expect(result.tools).toHaveLength(TOOL_NAMES.length);
		expect(toolNames).toEqual([...TOOL_NAMES].sort());
	});

	it("returns image content and dimension text for screenshot", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		const result = await client.callTool({ name: "screenshot", arguments: {} });

		// then
		expect(result.content).toEqual([
			{ type: "image", data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png" },
			{ type: "text", text: "Screenshot 1920x1080" },
		]);
	});

	it("calls the computer click method with the requested coordinates", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "click", arguments: { x: 123, y: 456, button: "left" } });

		// then
		expect(mockedComputer.click).toHaveBeenCalledOnce();
		expect(mockedComputer.click).toHaveBeenCalledWith({ x: 123, y: 456 });
	});

	it("maps a keypress array to sequential computer key calls", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "keypress", arguments: { keys: ["Meta", "K", "Enter"] } });

		// then
		expect(mockedComputer.key).toHaveBeenNthCalledWith(1, "Meta");
		expect(mockedComputer.key).toHaveBeenNthCalledWith(2, "K");
		expect(mockedComputer.key).toHaveBeenNthCalledWith(3, "Enter");
		expect(mockedComputer.key).toHaveBeenCalledTimes(3);
	});

	it("waits for the requested delay before returning text", async () => {
		// given
		vi.useFakeTimers();
		const { client, close } = await createHarness();
		closeHarness = close;
		let settled = false;

		// when
		const resultPromise = client.callTool({ name: "wait", arguments: { ms: 250 } }).then((result) => {
			settled = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(249);

		// then
		expect(settled).toBe(false);

		// when
		await vi.advanceTimersByTimeAsync(1);
		const result = await resultPromise;

		// then
		expect(settled).toBe(true);
		expect(result.content).toEqual([{ type: "text", text: "Waited 250ms" }]);
	});
});
