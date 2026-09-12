import type { AppState } from "@macos-cua/core";

export type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" };

export type ToolResult = {
	content: ToolContent[];
};

export function textResult(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

export function actionComplete(): ToolResult {
	return textResult("Action completed. Call `get_app_state` to fetch the updated UI state.");
}

/**
 * Tool result for an action that was observed immediately after dispatch. The
 * fresh state's accessibility diff is included so the model can confirm the
 * action's effect without a separate `get_app_state` call.
 */
export function observedActionComplete(state: AppState): ToolResult {
	const summary = state.axChangeSummary;
	const changed = summary === undefined ? "unknown" : `${summary.added}/${summary.removed}/${summary.changed}`;
	const observationStatus =
		summary === undefined
			? "unavailable"
			: summary.added === 0 && summary.removed === 0 && summary.changed === 0
				? "unchanged"
				: "changed";
	const verification =
		"The AX comparison is an observation, not proof of the intended outcome. Inspect the returned state before retrying; unavailable means there is no previous snapshot.";
	return {
		content: [
			{
				type: "text",
				text: `Action completed and observed. axChangeSummary ${changed}. ${verification}`,
			},
			{ type: "text", text: JSON.stringify({ ...state, observationStatus, screenshotBase64: undefined }, null, 2) },
		],
	};
}

export function clickComplete(): ToolResult {
	return textResult(
		"Action completed. Call `get_app_state` to fetch the updated UI state. The click was dispatched but may not have registered on the target. ALWAYS confirm by calling `get_app_state`: if the accessibility tree did not change (axChangeSummary 0/0/0), the click most likely missed — retry it once, or use `element_index` for a reliable accessibility press. Do NOT fall back to osascript, AppleScript, JXA, Swift, or any shell scripting to perform the click — those bypass this agent's native input path and are NOT allowed. ALWAYS use this `click` tool (with `element_index` when available) and simply retry it when a click does not register.",
	);
}
