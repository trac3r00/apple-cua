import { type ComputerInterface, resolveAppPid, withTargetedApp } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { actionCompleteResult } from "./result.js";

export const ScrollParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		direction: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")], {
			description: "Scroll direction.",
		}),
		element_index: Type.Optional(Type.String({ description: "Element index from get_app_state." })),
		pages: Type.Optional(Type.Number({ description: "Number of pages to scroll. Defaults to 1." })),
	},
	{ additionalProperties: false },
);

export type ScrollInput = Static<typeof ScrollParams>;

export function createScrollTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "scroll",
		label: "Computer Use: scroll",
		description: "Scroll an element in a direction by a number of pages.",
		parameters: ScrollParams,
		async execute(_toolCallId, params) {
			void params.element_index;
			const targetPid = await resolveAppPid(computer, params.app);
			await withTargetedApp(computer, targetPid, async () => {
				await computer.scroll({ direction: params.direction, amount: params.pages ?? 1 });
			});
			return actionCompleteResult();
		},
	});
}
