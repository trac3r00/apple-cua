import { type ComputerInterface, getAppStateForApp } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";

export const GetAppStateParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		diff_only: Type.Optional(
			Type.Boolean({
				description:
					"When true and a prior snapshot exists, omit the full accessibility tree and return only the diff (axChanges + axChangeSummary + contentKind). The first call always returns the full tree.",
			}),
		),
		include_screenshot: Type.Optional(
			Type.Boolean({
				description:
					"When false, skip the screenshot and return only element ids, roles, labels and frames. The cheapest way to re-index elements before an element action.",
			}),
		),
		max_elements: Type.Optional(
			Type.Number({
				description:
					"Cap the accessibility elements walked for very large windows. When the walk stops at the cap the state sets elementsTruncated.",
			}),
		),
		include_menu_bar: Type.Optional(
			Type.Boolean({
				description: "Include the application menu bar, which is app chrome rather than window content.",
			}),
		),
		window_id: Type.Optional(
			Type.Number({
				description:
					"Observe this WindowServer window id instead of the app's focused window. Use a candidate id from windowCandidates when an app has several windows.",
			}),
		),
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
			const state = await getAppStateForApp(computer, params.app, {
				...(params.diff_only === true ? { diffOnly: true } : {}),
				...(params.include_screenshot === undefined ? {} : { includeScreenshot: params.include_screenshot }),
				...(params.max_elements === undefined ? {} : { maxElements: params.max_elements }),
				...(params.include_menu_bar === undefined ? {} : { includeMenuBar: params.include_menu_bar }),
				...(params.window_id === undefined ? {} : { windowId: params.window_id }),
			});
			const content = [
				...(state.screenshotBase64.length === 0
					? []
					: [
							{
								type: "image" as const,
								data: state.screenshotBase64,
								mimeType: state.screenshotMimeType ?? "image/png",
							},
						]),
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
