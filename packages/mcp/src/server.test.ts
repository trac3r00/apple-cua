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
	setTarget: vi.fn(),
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
	getAppState: vi.fn(),
	getScreenshotViewport: vi.fn(),
	listApps: vi.fn(),
	setValue: vi.fn(),
	performAction: vi.fn(),
	pressAtPosition: vi.fn(),
	typeIntoFocused: vi.fn(),
	close: vi.fn(),
}));

vi.mock("@macos-cua/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@macos-cua/core")>();
	return {
		...actual,
		MacOSHostComputer: vi.fn(() => mockedComputer),
	};
});

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
	mockedComputer.getAppState.mockResolvedValue({
		app: "Finder",
		bundleId: "com.apple.finder",
		pid: 1234,
		frontmost: true,
		axAvailable: true,
		elements: [
			{
				id: 9,
				role: "AXButton",
				label: "Open",
				value: null,
				frame: { x: 100, y: 200, width: 20, height: 10 },
				actions: ["AXPress"],
				children: [],
			},
		],
		screenshotBase64: Buffer.from("png-bytes").toString("base64"),
		screenshotWidth: 1280,
		screenshotHeight: 720,
	});
	mockedComputer.listApps.mockResolvedValue([
		{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true },
	]);
	mockedComputer.setValue.mockResolvedValue(undefined);
	mockedComputer.performAction.mockResolvedValue(undefined);
	mockedComputer.pressAtPosition.mockResolvedValue(false);
	mockedComputer.typeIntoFocused.mockResolvedValue(false);
	mockedComputer.getScreenshotViewport.mockResolvedValue(undefined);
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

	it("returns image content and accessibility JSON for get_app_state", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		const result = await client.callTool({ name: "get_app_state", arguments: { app: "Finder" } });

		// then
		expect(result.content[0]).toEqual({
			type: "image",
			data: Buffer.from("png-bytes").toString("base64"),
			mimeType: "image/png",
		});
		expect(result.content[1]?.type).toBe("text");
		expect(mockedComputer.getAppState).toHaveBeenCalledWith(1234, undefined);
	});

	it("calls the computer click method with the requested app and coordinates", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "click", arguments: { app: "Finder", x: 123, y: 456, mouse_button: "left" } });

		// then
		expect(mockedComputer.click).toHaveBeenCalledOnce();
		expect(mockedComputer.click).toHaveBeenCalledWith({ x: 123, y: 456 });
		expect(mockedComputer.setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(mockedComputer.setTarget).toHaveBeenLastCalledWith(undefined);
	});

	it("maps screenshot pixel coordinates onto the window before clicking", async () => {
		// given
		mockedComputer.getScreenshotViewport.mockResolvedValue({
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		});
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "click", arguments: { app: "Finder", x: 250, y: 200 } });

		// then
		expect(mockedComputer.pressAtPosition).toHaveBeenCalledWith(1234, { x: 800, y: 550 });
		expect(mockedComputer.click).toHaveBeenCalledWith({ x: 800, y: 550 });
	});

	it("maps both drag endpoints onto the window before dragging", async () => {
		// given
		mockedComputer.getScreenshotViewport.mockResolvedValue({
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		});
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "drag", arguments: { app: "Finder", from_x: 0, from_y: 0, to_x: 250, to_y: 200 } });

		// then
		expect(mockedComputer.drag).toHaveBeenCalledWith({ from: { x: 300, y: 150 }, to: { x: 800, y: 550 } });
	});

	it("maps a press_key chord to a computer key call", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "press_key", arguments: { app: "Finder", key: "super+k" } });

		// then
		expect(mockedComputer.key).toHaveBeenCalledWith("k", { modifiers: ["command"] });
	});

	it("routes set_value and perform_secondary_action to accessibility helpers", async () => {
		// given
		const { client, close } = await createHarness();
		closeHarness = close;

		// when
		await client.callTool({ name: "set_value", arguments: { app: "Finder", element_index: "9", value: "abc" } });
		await client.callTool({
			name: "perform_secondary_action",
			arguments: { app: "Finder", element_index: "9", action: "AXPress" },
		});

		// then
		expect(mockedComputer.setValue).toHaveBeenCalledWith(1234, 9, "abc");
		expect(mockedComputer.performAction).toHaveBeenCalledWith(1234, 9, "AXPress");
	});
});
