import type { AgentToolResult } from "../pi/index.js";

const ACTION_COMPLETE_TEXT = "Action completed. Call `get_app_state` to fetch the updated UI state.";

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
