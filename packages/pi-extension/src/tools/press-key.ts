import { type ComputerInterface, parseKeyChord, resolveAppPid, withTargetedApp } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { actionCompleteResult } from "./result.js";

export const PressKeyParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		key: Type.String({ description: "Key or key combination to press, e.g. 'a', 'Return', or 'super+c'." }),
	},
	{ additionalProperties: false },
);

export type PressKeyInput = Static<typeof PressKeyParams>;

export function createPressKeyTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "press_key",
		label: "Computer Use: press key",
		description: "Press a key or key-combination on the keyboard, including modifier and navigation keys.",
		parameters: PressKeyParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			const keypress = parseKeyChord(params.key);
			await withTargetedApp(computer, targetPid, async () => {
				await computer.key(
					keypress.key,
					keypress.modifiers.length === 0 ? undefined : { modifiers: [...keypress.modifiers] },
				);
			});
			return actionCompleteResult();
		},
	});
}
