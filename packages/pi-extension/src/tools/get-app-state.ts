import { type ComputerInterface, getAppStateForApp } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";

export const GetAppStateParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
	},
	{ additionalProperties: false },
);

export type GetAppStateInput = Static<typeof GetAppStateParams>;

export function createGetAppStateTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "get_app_state",
		label: "Computer Use: get app state",
		description:
			"Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree.",
		parameters: GetAppStateParams,
		async execute(_toolCallId, params) {
			const state = await getAppStateForApp(computer, params.app);
			const content = [
				{ type: "image" as const, data: state.screenshotBase64, mimeType: state.screenshotMimeType ?? "image/png" },
				{ type: "text" as const, text: JSON.stringify({ ...state, screenshotBase64: undefined }, null, 2) },
			];
			if (state.appInstructions !== undefined) {
				content.push({
					type: "text" as const,
					text: `<app_specific_instructions>\n${state.appInstructions}\n</app_specific_instructions>`,
				});
			}
			return { content, details: state };
		},
	});
}
