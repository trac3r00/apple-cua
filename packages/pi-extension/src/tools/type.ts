import type { MacOSHostComputer } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

export const TypeParams = Type.Object(
	{
		text: Type.String({ description: "Text to type at the current focused insertion point." }),
	},
	{ additionalProperties: false },
);

export type TypeInput = Static<typeof TypeParams>;

export function createTypeTool(computer: MacOSHostComputer): ToolDefinition {
	return defineTool({
		name: "macos_cua_type",
		label: "macOS CUA: type",
		description: "Type text into the active macOS application.",
		parameters: TypeParams,
		async execute(_toolCallId, params) {
			await computer.type(params.text);
			return textResult(`Typed ${params.text.length} character${params.text.length === 1 ? "" : "s"}.`);
		},
	});
}
