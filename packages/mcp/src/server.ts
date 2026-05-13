#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { MacOSHostComputer } from "@macos-cua/core";
import type { ComputerInterface, DragOptions, ScrollOptions } from "@macos-cua/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" };

type ToolResult = {
	content: ToolContent[];
};

const SERVER_INFO = {
	name: "macos-cua",
	version: "0.1.0",
} as const;

export const TOOL_NAMES = [
	"screenshot",
	"click",
	"double_click",
	"scroll",
	"type",
	"wait",
	"keypress",
	"drag",
	"move",
	"cursor_position",
	"screen_size",
] as const;

const pointSchema = z.object({
	x: z.number(),
	y: z.number(),
});

const screenshotSchema = z.object({
	region: z
		.object({
			x: z.number(),
			y: z.number(),
			width: z.number(),
			height: z.number(),
		})
		.optional(),
});

const clickSchema = z.object({
	x: z.number(),
	y: z.number(),
	button: z.string().optional(),
});

const doubleClickSchema = z.object({
	x: z.number(),
	y: z.number(),
});

const scrollSchema = z.object({
	x: z.number(),
	y: z.number(),
	scrollX: z.number(),
	scrollY: z.number(),
});

const typeSchema = z.object({
	text: z.string(),
});

const waitSchema = z.object({
	ms: z.number().nonnegative(),
});

const keypressSchema = z.object({
	keys: z.array(z.string()).min(1),
});

const dragSchema = z.union([
	z.object({
		path: z.array(pointSchema).min(2),
	}),
	z.object({
		fromX: z.number(),
		fromY: z.number(),
		toX: z.number(),
		toY: z.number(),
	}),
]);

const moveSchema = z.object({
	x: z.number(),
	y: z.number(),
});

const emptySchema = z.object({});

function textResult(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function scrollOptionsFromDeltas(scrollX: number, scrollY: number): ScrollOptions[] {
	const options: ScrollOptions[] = [];

	if (scrollX < 0) {
		options.push({ direction: "left", amount: Math.abs(scrollX) });
	} else if (scrollX > 0) {
		options.push({ direction: "right", amount: scrollX });
	}

	if (scrollY < 0) {
		options.push({ direction: "up", amount: Math.abs(scrollY) });
	} else if (scrollY > 0) {
		options.push({ direction: "down", amount: scrollY });
	}

	return options;
}

function dragOptionsFromPath(path: Array<{ x: number; y: number }>): DragOptions[] {
	const firstPoint = path[0];
	if (!firstPoint) {
		return [];
	}

	const options: DragOptions[] = [];
	let previousPoint = firstPoint;

	for (const point of path.slice(1)) {
		options.push({ from: previousPoint, to: point });
		previousPoint = point;
	}

	return options;
}

export function createMcpServer(computer: ComputerInterface = new MacOSHostComputer()): McpServer {
	const server = new McpServer(SERVER_INFO);

	server.registerTool(
		"screenshot",
		{
			description: "Capture a screenshot of the macOS screen",
			inputSchema: screenshotSchema,
		},
		async ({ region }): Promise<ToolResult> => {
			const result = await computer.screenshot(region ? { region } : undefined);

			return {
				content: [
					{
						type: "image",
						data: result.data.toString("base64"),
						mimeType: result.mimeType,
					},
					{
						type: "text",
						text: `Screenshot ${result.width}x${result.height}`,
					},
				],
			};
		},
	);

	server.registerTool(
		"click",
		{
			description: "Click at a specific position on the screen",
			inputSchema: clickSchema,
		},
		async ({ x, y }): Promise<ToolResult> => {
			await computer.click({ x, y });
			return textResult(`Clicked at ${x},${y}`);
		},
	);

	server.registerTool(
		"double_click",
		{
			description: "Double-click at a specific position on the screen",
			inputSchema: doubleClickSchema,
		},
		async ({ x, y }): Promise<ToolResult> => {
			await computer.doubleClick({ x, y });
			return textResult(`Double-clicked at ${x},${y}`);
		},
	);

	server.registerTool(
		"scroll",
		{
			description: "Scroll at a screen position using Cartesian deltas",
			inputSchema: scrollSchema,
		},
		async ({ x, y, scrollX, scrollY }): Promise<ToolResult> => {
			for (const options of scrollOptionsFromDeltas(scrollX, scrollY)) {
				await computer.scroll(options);
			}

			return textResult(`Scrolled at ${x},${y} by ${scrollX},${scrollY}`);
		},
	);

	server.registerTool(
		"type",
		{
			description: "Type text at the current cursor position",
			inputSchema: typeSchema,
		},
		async ({ text }): Promise<ToolResult> => {
			await computer.type(text);
			return textResult(`Typed: ${text}`);
		},
	);

	server.registerTool(
		"wait",
		{
			description: "Wait for the specified number of milliseconds",
			inputSchema: waitSchema,
		},
		async ({ ms }): Promise<ToolResult> => {
			await sleep(ms);
			return textResult(`Waited ${ms}ms`);
		},
	);

	server.registerTool(
		"keypress",
		{
			description: "Press one or more keys in sequence",
			inputSchema: keypressSchema,
		},
		async ({ keys }): Promise<ToolResult> => {
			for (const key of keys) {
				await computer.key(key);
			}

			return textResult(`Pressed keys: ${keys.join(",")}`);
		},
	);

	server.registerTool(
		"drag",
		{
			description: "Drag along a path, or from one point to another",
			inputSchema: dragSchema,
		},
		async (params): Promise<ToolResult> => {
			if ("path" in params) {
				for (const options of dragOptionsFromPath(params.path)) {
					await computer.drag(options);
				}

				const firstPoint = params.path[0];
				const lastPoint = params.path[params.path.length - 1];
				if (!firstPoint || !lastPoint) {
					throw new Error("Drag path must contain at least two points");
				}

				return textResult(`Dragged from ${firstPoint.x},${firstPoint.y} to ${lastPoint.x},${lastPoint.y}`);
			}

			await computer.drag({
				from: { x: params.fromX, y: params.fromY },
				to: { x: params.toX, y: params.toY },
			});
			return textResult(`Dragged from ${params.fromX},${params.fromY} to ${params.toX},${params.toY}`);
		},
	);

	server.registerTool(
		"move",
		{
			description: "Move the cursor to a specific position",
			inputSchema: moveSchema,
		},
		async ({ x, y }): Promise<ToolResult> => {
			await computer.drag({ from: { x, y }, to: { x, y } });
			return textResult(`Moved to ${x},${y}`);
		},
	);

	server.registerTool(
		"cursor_position",
		{
			description: "Get the current cursor position",
			inputSchema: emptySchema,
		},
		async (): Promise<ToolResult> => {
			const position = await computer.getCursorPosition();
			return textResult(`Cursor position: ${position.x},${position.y}`);
		},
	);

	server.registerTool(
		"screen_size",
		{
			description: "Get the screen size",
			inputSchema: emptySchema,
		},
		async (): Promise<ToolResult> => {
			const size = await computer.getScreenSize();
			return textResult(`Screen size: ${size.width}x${size.height}`);
		},
	);

	return server;
}

export async function main(): Promise<void> {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}
