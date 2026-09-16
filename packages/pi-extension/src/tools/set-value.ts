import { type ComputerInterface, observeAction, parseElementIndex, resolveAppPid } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import type { AppObservationKeys } from "./observations.js";
import { observedActionCompleteResult } from "./result.js";

export const SetValueParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		element_index: Type.String({ description: "Element index from get_app_state." }),
		value: Type.String({ description: "Value to assign." }),
	},
	{ additionalProperties: false },
);

export type SetValueInput = Static<typeof SetValueParams>;

export function createSetValueTool(computer: ComputerInterface, observations: AppObservationKeys): ToolDefinition {
	return defineTool({
		name: "set_value",
		label: "Computer Use: set value",
		description: "Set the value of a settable accessibility element.",
		parameters: SetValueParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			observations.assertCurrent(computer, targetPid, params.app);
			const state = await observeAction(computer, targetPid, async () => {
				await computer.setValue(targetPid, parseElementIndex(params.element_index), params.value);
			});
			return observedActionCompleteResult(state);
		},
	});
}
