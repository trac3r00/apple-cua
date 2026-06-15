import type { Point } from "@macos-cua/core";
import type { AgentToolResult } from "../pi/index.js";

const ACTION_COMPLETE_TEXT = "Action completed. Call `get_app_state` to fetch the updated UI state.";

// A dispatched click is fire-and-forget and can silently miss; every click result must instruct the model to verify and retry.
const CLICK_VERIFY_TEXT =
	"The click was dispatched but may not have registered on the target. ALWAYS confirm by calling `get_app_state`: if the accessibility tree did not change (axChangeSummary 0/0/0), the click most likely missed — retry it once, or use `element_index` for a reliable accessibility press.";

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
