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

export function clickComplete(): ToolResult {
	return textResult(
		"Action completed. Call `get_app_state` to fetch the updated UI state. The click was dispatched but may not have registered on the target. ALWAYS confirm by calling `get_app_state`: if the accessibility tree did not change (axChangeSummary 0/0/0), the click most likely missed — retry it once, or use `element_index` for a reliable accessibility press. Do NOT fall back to osascript, AppleScript, JXA, Swift, or any shell scripting to perform the click — those bypass this agent's native input path and are NOT allowed. ALWAYS use this `click` tool (with `element_index` when available) and simply retry it when a click does not register.",
	);
}
