import type { AppState } from "@apple-cua/core";
import type { AgentToolResult } from "../pi/index.js";

export function textResult<TDetails = undefined>(
	text: string,
	details?: TDetails,
): AgentToolResult<TDetails | undefined> {
	return {
		content: [{ type: "text", text }],
		details: details as TDetails | undefined,
	};
}

// Post-action verification: the fresh state's accessibility diff, so the model confirms the effect without a separate get_app_state call.
export function observedActionCompleteResult(state: AppState): AgentToolResult<undefined> {
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
	return textResult(
		`Action completed and observed. axChangeSummary ${changed}. ${verification} Do NOT fall back to osascript, AppleScript, JXA, Swift, or any shell scripting to perform actions — those bypass this agent's native input path and are NOT allowed.\n${JSON.stringify({ ...state, observationStatus, screenshotBase64: undefined, elements: undefined }, null, 2)}`,
	);
}
