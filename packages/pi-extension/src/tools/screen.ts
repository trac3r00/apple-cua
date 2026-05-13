import type { MacOSHostComputer } from "@macos-cua/core";
import { Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export const ScreenSizeParams = Type.Object({}, { additionalProperties: false });

export function createScreenSizeTool(computer: MacOSHostComputer): ToolDefinition {
	return defineTool({
		name: "macos_cua_screen_size",
		label: "macOS CUA: screen size",
		description: "Return the current macOS screen size.",
		parameters: ScreenSizeParams,
		async execute(_toolCallId, _params) {
			const size = await computer.getScreenSize();
			return textResult(`Screen size: ${size.width}x${size.height}.`, size);
		},
	});
}
