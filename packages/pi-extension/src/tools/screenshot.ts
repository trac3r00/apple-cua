import type { ComputerInterface } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { multiContentResult } from "./result.js";

const RegionParams = Type.Object(
	{
		x: Type.Integer({ description: "Left X coordinate in pixels." }),
		y: Type.Integer({ description: "Top Y coordinate in pixels." }),
		width: Type.Integer({ description: "Region width in pixels." }),
		height: Type.Integer({ description: "Region height in pixels." }),
	},
	{ additionalProperties: false },
);

export const ScreenshotParams = Type.Object(
	{
		region: Type.Optional(RegionParams),
	},
	{ additionalProperties: false },
);

export type ScreenshotInput = Static<typeof ScreenshotParams>;

export function createScreenshotTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "macos_cua_screenshot",
		label: "macOS CUA: screenshot",
		description: "Capture a PNG screenshot of the macOS screen. Optionally restrict capture to a rectangular region.",
		parameters: ScreenshotParams,
		async execute(_toolCallId, params) {
			const result = await computer.screenshot(params.region === undefined ? undefined : { region: params.region });
			return multiContentResult(result.data.toString("base64"), `Screenshot ${result.width}x${result.height}`);
		},
	});
}
