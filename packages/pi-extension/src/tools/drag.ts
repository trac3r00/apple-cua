import type { ComputerInterface } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export const DragParams = Type.Object(
	{
		fromX: Type.Integer({ description: "Starting X coordinate in pixels." }),
		fromY: Type.Integer({ description: "Starting Y coordinate in pixels." }),
		toX: Type.Integer({ description: "Ending X coordinate in pixels." }),
		toY: Type.Integer({ description: "Ending Y coordinate in pixels." }),
	},
	{ additionalProperties: false },
);

export type DragInput = Static<typeof DragParams>;

export function createDragTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "macos_cua_drag",
		label: "macOS CUA: drag",
		description: "Drag from one macOS screen coordinate to another.",
		parameters: DragParams,
		async execute(_toolCallId, params) {
			await computer.drag({
				from: { x: params.fromX, y: params.fromY },
				to: { x: params.toX, y: params.toY },
			});
			return textResult(`Dragged from (${params.fromX}, ${params.fromY}) to (${params.toX}, ${params.toY}).`);
		},
	});
}
