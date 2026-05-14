import type { ComputerInterface } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

const MouseButton = Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")], {
	description: "Mouse button. macos-cua currently maps all buttons to the host click primitive.",
});

export const ClickParams = Type.Object(
	{
		x: Type.Integer({ description: "X coordinate in pixels." }),
		y: Type.Integer({ description: "Y coordinate in pixels." }),
		button: Type.Optional(MouseButton),
	},
	{ additionalProperties: false },
);

export type ClickInput = Static<typeof ClickParams>;

export function createClickTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "macos_cua_click",
		label: "macOS CUA: click",
		description: "Click at the given (x, y) coordinate on the macOS screen.",
		parameters: ClickParams,
		async execute(_toolCallId, params) {
			await computer.click({ x: params.x, y: params.y });
			return textResult(`Clicked at (${params.x}, ${params.y}).`);
		},
	});
}
