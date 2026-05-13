import type { MacOSHostComputer } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export const ScrollParams = Type.Object(
	{
		direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")], {
			description: "Scroll direction.",
		}),
		amount: Type.Integer({ description: "Scroll amount in native macOS scroll units." }),
	},
	{ additionalProperties: false },
);

export type ScrollInput = Static<typeof ScrollParams>;

export function createScrollTool(computer: MacOSHostComputer): ToolDefinition {
	return defineTool({
		name: "macos_cua_scroll",
		label: "macOS CUA: scroll",
		description: "Scroll in a direction on the macOS screen.",
		parameters: ScrollParams,
		async execute(_toolCallId, params) {
			await computer.scroll({ direction: params.direction, amount: params.amount });
			return textResult(`Scrolled ${params.direction} by ${params.amount}.`);
		},
	});
}
