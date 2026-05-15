import { type ComputerInterface, resolveAppPid, withTargetedApp } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { actionCompleteResult } from "./result.js";

export const TypeTextParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		text: Type.String({ description: "Literal text to type." }),
	},
	{ additionalProperties: false },
);

export type TypeTextInput = Static<typeof TypeTextParams>;

export function createTypeTextTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "type_text",
		label: "Computer Use: type text",
		description: "Type literal text using keyboard input.",
		parameters: TypeTextParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			if (await computer.typeIntoFocused(targetPid, params.text)) {
				return actionCompleteResult();
			}
			await withTargetedApp(computer, targetPid, async () => {
				await computer.type(params.text);
			});
			return actionCompleteResult();
		},
	});
}
