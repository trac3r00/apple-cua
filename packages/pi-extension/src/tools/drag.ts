import {
	type ComputerInterface,
	observeAction,
	resolveAppPid,
	resolveScreenPoint,
	withTargetedApp,
} from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import type { AppObservationKeys } from "./observations.js";
import { observedActionCompleteResult } from "./result.js";

export const DragParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		from_x: Type.Number({ description: "Start X coordinate." }),
		from_y: Type.Number({ description: "Start Y coordinate." }),
		to_x: Type.Number({ description: "End X coordinate." }),
		to_y: Type.Number({ description: "End Y coordinate." }),
	},
	{ additionalProperties: false },
);

export type DragInput = Static<typeof DragParams>;

export function createDragTool(computer: ComputerInterface, observations: AppObservationKeys): ToolDefinition {
	return defineTool({
		name: "drag",
		label: "Computer Use: drag",
		description: "Drag from one point to another using pixel coordinates.",
		parameters: DragParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			observations.assertCurrent(computer, targetPid, params.app);
			const from = await resolveScreenPoint(computer, targetPid, { x: params.from_x, y: params.from_y });
			const to = await resolveScreenPoint(computer, targetPid, { x: params.to_x, y: params.to_y });
			const state = await observeAction(computer, targetPid, async () => {
				await withTargetedApp(computer, targetPid, async () => {
					await computer.drag({ from, to });
				});
			});
			return observedActionCompleteResult(state);
		},
	});
}
