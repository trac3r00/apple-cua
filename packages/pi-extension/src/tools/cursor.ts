import type { MacOSHostComputer } from "@macos-cua/core";
import { Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export const CursorPositionParams = Type.Object({}, { additionalProperties: false });

export function createCursorPositionTool(computer: MacOSHostComputer): ToolDefinition {
	return defineTool({
		name: "macos_cua_cursor_position",
		label: "macOS CUA: cursor position",
		description: "Return the current macOS cursor position.",
		parameters: CursorPositionParams,
		async execute(_toolCallId, _params) {
			const position = await computer.getCursorPosition();
			return textResult(`Cursor position: (${position.x}, ${position.y}).`, position);
		},
	});
}
