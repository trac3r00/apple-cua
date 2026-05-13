import type { MacOSHostComputer } from "@macos-cua/core";
import { click } from "./click.js";
import { cursorPosition } from "./cursor.js";
import { doubleClick } from "./doubleClick.js";
import { drag } from "./drag.js";
import { key } from "./key.js";
import { screenSize } from "./screen.js";
import { screenshot } from "./screenshot.js";
import { scroll } from "./scroll.js";
import { typeText } from "./type.js";

export type ToolResult = {
	content: Array<
		{ type: "image"; data: string; mimeType: "image/png" | "image/jpeg" } | { type: "text"; text: string }
	>;
};

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	handler: (computer: MacOSHostComputer, args: Record<string, unknown>) => Promise<ToolResult>;
}

export function createTools(computer: MacOSHostComputer): ToolDefinition[] {
	return [
		{
			name: "screenshot",
			description: "Capture a screenshot of the macOS screen",
			parameters: {
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
			handler: async (_, args) =>
				screenshot(computer, args as { region?: { x: number; y: number; width: number; height: number } }),
		},
		{
			name: "click",
			description: "Click at a specific position on the screen",
			parameters: {
				type: "object",
				properties: {
					x: { type: "number" },
					y: { type: "number" },
				},
				required: ["x", "y"],
			},
			handler: async (_, args) => click(computer, args as { x: number; y: number }),
		},
		{
			name: "double_click",
			description: "Double-click at a specific position on the screen",
			parameters: {
				type: "object",
				properties: {
					x: { type: "number" },
					y: { type: "number" },
				},
				required: ["x", "y"],
			},
			handler: async (_, args) => doubleClick(computer, args as { x: number; y: number }),
		},
		{
			name: "type",
			description: "Type text at the current cursor position",
			parameters: {
				type: "object",
				properties: {
					text: { type: "string" },
				},
				required: ["text"],
			},
			handler: async (_, args) => typeText(computer, args as { text: string }),
		},
		{
			name: "key",
			description: "Press a key with optional modifiers",
			parameters: {
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
			handler: async (_, args) => key(computer, args as { key: string; modifiers?: Array<string> }),
		},
		{
			name: "scroll",
			description: "Scroll in a direction",
			parameters: {
				type: "object",
				properties: {
					direction: { type: "string", enum: ["up", "down", "left", "right"] },
					amount: { type: "number" },
				},
				required: ["direction", "amount"],
			},
			handler: async (_, args) =>
				scroll(computer, args as { direction: "up" | "down" | "left" | "right"; amount: number }),
		},
		{
			name: "drag",
			description: "Drag from one point to another",
			parameters: {
				type: "object",
				properties: {
					fromX: { type: "number" },
					fromY: { type: "number" },
					toX: { type: "number" },
					toY: { type: "number" },
				},
				required: ["fromX", "fromY", "toX", "toY"],
			},
			handler: async (_, args) => drag(computer, args as { fromX: number; fromY: number; toX: number; toY: number }),
		},
		{
			name: "cursor_position",
			description: "Get the current cursor position",
			parameters: {
				type: "object",
				properties: {},
			},
			handler: async () => cursorPosition(computer),
		},
		{
			name: "screen_size",
			description: "Get the screen size",
			parameters: {
				type: "object",
				properties: {},
			},
			handler: async () => screenSize(computer),
		},
	];
}
