import { type ComputerInterface, parseElementIndex, resolveAppPid } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { actionCompleteResult } from "./result.js";

export const SetValueParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		element_index: Type.String({ description: "Element index from get_app_state." }),
		value: Type.String({ description: "Value to assign." }),
	},
	{ additionalProperties: false },
);

export type SetValueInput = Static<typeof SetValueParams>;

export function createSetValueTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "set_value",
		label: "Computer Use: set value",
		description: "Set the value of a settable accessibility element.",
		parameters: SetValueParams,
		async execute(_toolCallId, params) {
			await computer.setValue(
				await resolveAppPid(computer, params.app),
				parseElementIndex(params.element_index),
				params.value,
			);
			return actionCompleteResult();
		},
	});
}
