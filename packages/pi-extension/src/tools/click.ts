import {
	type ComputerInterface,
	clickPoint,
	parseElementIndex,
	pressElement,
	resolveAppPid,
	resolveScreenPoint,
	withTargetedApp,
} from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { actionCompleteResult } from "./result.js";

const MouseButton = Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]);

export const ClickParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		element_index: Type.Optional(Type.String({ description: "Element index from get_app_state." })),
		x: Type.Optional(Type.Number({ description: "X coordinate in screenshot pixel coordinates." })),
		y: Type.Optional(Type.Number({ description: "Y coordinate in screenshot pixel coordinates." })),
		click_count: Type.Optional(Type.Integer({ minimum: 1, description: "Number of clicks. Defaults to 1." })),
		mouse_button: Type.Optional(MouseButton),
	},
	{ additionalProperties: false },
);

export type ClickInput = Static<typeof ClickParams>;

export function createClickTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "click",
		label: "Computer Use: click",
		description: "Click an element by index or pixel coordinates from screenshot.",
		parameters: ClickParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			const pressCount = Math.max(1, Math.trunc(params.click_count ?? 1));
			if (params.element_index !== undefined) {
				const index = parseElementIndex(params.element_index);
				for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
					await pressElement(computer, targetPid, index);
				}
				void params.mouse_button;
				return actionCompleteResult();
			}
			const point = await resolveScreenPoint(computer, targetPid, parseCoordinate(params.x, params.y));
			if ((params.mouse_button ?? "left") === "left") {
				let pressedAll = true;
				for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
					if (!(await computer.pressAtPosition(targetPid, point))) {
						pressedAll = false;
						break;
					}
				}
				if (pressedAll) {
					return actionCompleteResult();
				}
			}
			await withTargetedApp(computer, targetPid, async () => {
				await clickPoint(computer, point, params.mouse_button ?? "left", pressCount);
			});
			return actionCompleteResult();
		},
	});
}

function parseCoordinate(x: number | undefined, y: number | undefined): { x: number; y: number } {
	if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error("click requires either element_index or finite x and y coordinates");
	}
	return { x, y };
}
