import type { AppState, Point } from "@macos-cua/core";
import type { AgentToolResult } from "../pi/index.js";

const ACTION_COMPLETE_TEXT = "Action completed. Call `get_app_state` to fetch the updated UI state.";

// A dispatched click is fire-and-forget and can silently miss; every click result must instruct the model to verify and retry.
const CLICK_VERIFY_TEXT =
	"The click was dispatched but may not have registered on the target. ALWAYS confirm by calling `get_app_state`: if the accessibility tree did not change (axChangeSummary 0/0/0), the click most likely missed — retry it once, or use `element_index` for a reliable accessibility press. Do NOT fall back to osascript, AppleScript, JXA, Swift, or any shell scripting to perform the click — those bypass this agent's native input path and are NOT allowed. ALWAYS use this `click` tool (with `element_index` when available) and simply retry it when a click does not register.";

export interface CursorFeedback {
	cursorBefore: Point;
	cursorAfter: Point;
}

export function actionCompleteWithCursor(cursorBefore: Point, cursorAfter: Point): AgentToolResult<CursorFeedback> {
	return {
		content: [
			{
				type: "text",
				text: `${ACTION_COMPLETE_TEXT} Pointer before (${cursorBefore.x}, ${cursorBefore.y}); after (${cursorAfter.x}, ${cursorAfter.y}).`,
			},
		],
		details: { cursorBefore, cursorAfter },
	};
}

export function clickCompleteWithCursor(cursorBefore: Point, cursorAfter: Point): AgentToolResult<CursorFeedback> {
	return {
		content: [
			{
				type: "text",
				text: `${ACTION_COMPLETE_TEXT} Pointer before (${cursorBefore.x}, ${cursorBefore.y}); after (${cursorAfter.x}, ${cursorAfter.y}). ${CLICK_VERIFY_TEXT}`,
			},
		],
		details: { cursorBefore, cursorAfter },
	};
}

export function clickCompleteResult(): AgentToolResult<undefined> {
	return textResult(`${ACTION_COMPLETE_TEXT} ${CLICK_VERIFY_TEXT}`);
}

export function textResult<TDetails = undefined>(
	text: string,
	details?: TDetails,
): AgentToolResult<TDetails | undefined> {
	return {
		content: [{ type: "text", text }],
		details: details as TDetails | undefined,
	};
}

export function actionCompleteResult(): AgentToolResult<undefined> {
	return textResult(ACTION_COMPLETE_TEXT);
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

export function imageResult<TDetails = undefined>(
	pngBase64: string,
	details?: TDetails,
): AgentToolResult<TDetails | undefined> {
	return {
		content: [{ type: "image", data: pngBase64, mimeType: "image/png" }],
		details: details as TDetails | undefined,
	};
}

export function multiContentResult<TDetails = undefined>(
	pngBase64: string,
	text: string,
	details?: TDetails,
): AgentToolResult<TDetails | undefined> {
	return {
		content: [
			{ type: "image", data: pngBase64, mimeType: "image/png" },
			{ type: "text", text },
		],
		details: details as TDetails | undefined,
	};
}
