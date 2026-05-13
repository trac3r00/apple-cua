#!/usr/bin/env node
import { MacOSHostComputer } from "@macos-cua/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const computer = new MacOSHostComputer();

const tools: Tool[] = [
	{
		name: "screenshot",
		description: "Capture a screenshot of the macOS screen",
		inputSchema: {
			type: "object",
			properties: {
				region: {
					type: "object",
					properties: {
						x: { type: "number" },
						y: { type: "number" },
						width: { type: "number" },
						height: { type: "number" },
					},
				},
			},
		},
	},
	{
		name: "click",
		description: "Click at a specific position on the screen",
		inputSchema: {
			type: "object",
			properties: {
				x: { type: "number" },
				y: { type: "number" },
			},
			required: ["x", "y"],
		},
	},
	{
		name: "double_click",
		description: "Double-click at a specific position on the screen",
		inputSchema: {
			type: "object",
			properties: {
				x: { type: "number" },
				y: { type: "number" },
			},
			required: ["x", "y"],
		},
	},
	{
		name: "type",
		description: "Type text at the current cursor position",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string" },
			},
			required: ["text"],
		},
	},
	{
		name: "key",
		description: "Press a key with optional modifiers",
		inputSchema: {
			type: "object",
			properties: {
				key: { type: "string" },
				modifiers: {
					type: "array",
					items: { type: "string" },
				},
			},
			required: ["key"],
		},
	},
	{
		name: "scroll",
		description: "Scroll in a direction",
		inputSchema: {
			type: "object",
			properties: {
				direction: { type: "string", enum: ["up", "down", "left", "right"] },
				amount: { type: "number" },
			},
			required: ["direction", "amount"],
		},
	},
	{
		name: "drag",
		description: "Drag from one point to another",
		inputSchema: {
			type: "object",
			properties: {
				fromX: { type: "number" },
				fromY: { type: "number" },
				toX: { type: "number" },
				toY: { type: "number" },
			},
			required: ["fromX", "fromY", "toX", "toY"],
		},
	},
	{
		name: "cursor_position",
		description: "Get the current cursor position",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "screen_size",
		description: "Get the screen size",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
];

const server = new Server(
	{
		name: "macos-cua",
		version: "0.1.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: rawArgs } = request.params;
	const args = rawArgs as Record<string, unknown>;

	switch (name) {
		case "screenshot": {
			const region = args["region"] as { x: number; y: number; width: number; height: number } | undefined;
			const result = await computer.screenshot(region ? { region } : undefined);
			return {
				content: [
					{
						type: "image",
						data: result.data.toString("base64"),
						mimeType: result.mimeType,
					},
				],
			};
		}
		case "click": {
			const x = args["x"] as number;
			const y = args["y"] as number;
			await computer.click({ x, y });
			return {
				content: [{ type: "text", text: `Clicked at ${x},${y}` }],
			};
		}
		case "double_click": {
			const x = args["x"] as number;
			const y = args["y"] as number;
			await computer.doubleClick({ x, y });
			return {
				content: [{ type: "text", text: `Double-clicked at ${x},${y}` }],
			};
		}
		case "type": {
			const text = args["text"] as string;
			await computer.type(text);
			return {
				content: [{ type: "text", text: `Typed: ${text}` }],
			};
		}
		case "key": {
			const keyName = args["key"] as string;
			const rawModifiers = args["modifiers"] as Array<string> | undefined;
			const modifiers = rawModifiers?.map((m) => {
				switch (m) {
					case "cmd":
						return "command";
					case "alt":
						return "option";
					case "ctrl":
						return "control";
					case "shift":
						return "shift";
					default:
						return m as "command" | "option" | "control" | "shift";
				}
			});
			await computer.key(keyName, modifiers ? { modifiers } : undefined);
			return {
				content: [
					{
						type: "text",
						text: `Pressed key: ${keyName}${modifiers ? ` with ${modifiers.join("+")}` : ""}`,
					},
				],
			};
		}
		case "scroll": {
			const direction = args["direction"] as "up" | "down" | "left" | "right";
			const amount = args["amount"] as number;
			await computer.scroll({ direction, amount });
			return {
				content: [
					{
						type: "text",
						text: `Scrolled ${direction} by ${amount}`,
					},
				],
			};
		}
		case "drag": {
			const fromX = args["fromX"] as number;
			const fromY = args["fromY"] as number;
			const toX = args["toX"] as number;
			const toY = args["toY"] as number;
			await computer.drag({
				from: { x: fromX, y: fromY },
				to: { x: toX, y: toY },
			});
			return {
				content: [
					{
						type: "text",
						text: `Dragged from ${fromX},${fromY} to ${toX},${toY}`,
					},
				],
			};
		}
		case "cursor_position": {
			const pos = await computer.getCursorPosition();
			return {
				content: [{ type: "text", text: `Cursor position: ${pos.x},${pos.y}` }],
			};
		}
		case "screen_size": {
			const size = await computer.getScreenSize();
			return {
				content: [
					{
						type: "text",
						text: `Screen size: ${size.width}x${size.height}`,
					},
				],
			};
		}
		default:
			throw new Error(`Unknown tool: ${name}`);
	}
});

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
