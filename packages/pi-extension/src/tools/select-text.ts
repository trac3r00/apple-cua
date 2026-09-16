import {
	type ComputerInterface,
	type SelectTextOptions,
	observeAction,
	parseElementIndex,
	resolveAppPid,
} from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import type { AppObservationKeys } from "./observations.js";
import { observedActionCompleteResult } from "./result.js";

const Selection = Type.Union([Type.Literal("text"), Type.Literal("before"), Type.Literal("after")]);

export const SelectTextParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		element_index: Type.String({ description: "Text element index from get_app_state." }),
		text: Type.Optional(Type.String({ description: "Target text as shown in the accessibility tree." })),
		prefix: Type.Optional(
			Type.String({ description: "Text immediately before the target, to disambiguate matches." }),
		),
		suffix: Type.Optional(
			Type.String({ description: "Text immediately after the target, to disambiguate matches." }),
		),
		selection: Type.Optional(Selection),
	},
	{ additionalProperties: false },
);

export type SelectTextInput = Static<typeof SelectTextParams>;

export function createSelectTextTool(computer: ComputerInterface, observations: AppObservationKeys): ToolDefinition {
	return defineTool({
		name: "select_text",
		label: "Computer Use: select text",
		description:
			"Select text inside a text element, or place the text cursor before or after it. Provide text exactly as it appears in the accessibility tree; use prefix or suffix to disambiguate repeated matches.",
		parameters: SelectTextParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			observations.assertCurrent(computer, targetPid, params.app);
			const state = await observeAction(computer, targetPid, async () => {
				await computer.selectText(targetPid, parseElementIndex(params.element_index), toSelectTextOptions(params));
			});
			return observedActionCompleteResult(state);
		},
	});
}

function toSelectTextOptions(params: SelectTextInput): SelectTextOptions {
	const options: SelectTextOptions = { selection: params.selection ?? "text" };
	return {
		...options,
		...(params.text !== undefined ? { text: params.text } : {}),
		...(params.prefix !== undefined ? { prefix: params.prefix } : {}),
		...(params.suffix !== undefined ? { suffix: params.suffix } : {}),
	};
}
