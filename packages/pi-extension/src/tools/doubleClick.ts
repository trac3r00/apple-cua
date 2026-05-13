import type { MacOSHostComputer } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export const DoubleClickParams = Type.Object(
	{
		x: Type.Integer({ description: "X coordinate in pixels." }),
		y: Type.Integer({ description: "Y coordinate in pixels." }),
		button: Type.Optional(
			Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")], {
				description: "Mouse button. macos-cua currently maps all buttons to the host double-click primitive.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type DoubleClickInput = Static<typeof DoubleClickParams>;

export function createDoubleClickTool(computer: MacOSHostComputer): ToolDefinition {
	return defineTool({
		name: "macos_cua_double_click",
		label: "macOS CUA: double click",
		description: "Double-click at the given (x, y) coordinate on the macOS screen.",
		parameters: DoubleClickParams,
		async execute(_toolCallId, params) {
			await computer.doubleClick({ x: params.x, y: params.y });
			return textResult(`Double-clicked at (${params.x}, ${params.y}).`);
		},
	});
}
