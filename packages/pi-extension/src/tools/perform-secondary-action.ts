import { type ComputerInterface, observeAction, parseElementIndex, resolveAppPid } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import type { AppObservationKeys } from "./observations.js";
import { observedActionCompleteResult } from "./result.js";

export const PerformSecondaryActionParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		element_index: Type.String({ description: "Element index from get_app_state." }),
		action: Type.String({ description: "Secondary accessibility action name." }),
	},
	{ additionalProperties: false },
);

export type PerformSecondaryActionInput = Static<typeof PerformSecondaryActionParams>;

export function createPerformSecondaryActionTool(
	computer: ComputerInterface,
	observations: AppObservationKeys,
): ToolDefinition {
	return defineTool({
		name: "perform_secondary_action",
		label: "Computer Use: perform action",
		description: "Invoke a secondary accessibility action exposed by an element.",
		parameters: PerformSecondaryActionParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			observations.assertCurrent(computer, targetPid, params.app);
			const state = await observeAction(computer, targetPid, async () => {
				await computer.performAction(targetPid, parseElementIndex(params.element_index), params.action);
			});
			return observedActionCompleteResult(state);
		},
	});
}
