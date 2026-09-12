import type { AppState } from "@macos-cua/core";

export type ToolContent =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "image"; readonly data: string; readonly mimeType: "image/png" | "image/jpeg" };

export type ToolResult = {
	readonly content: ToolContent[];
};

export function textResult(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

export function stateResult(state: AppState, observationToken?: string): ToolResult {
	return {
		content: [
			stateImage(state),
			{
				type: "text",
				text: JSON.stringify(
					{
						...state,
						screenshotBase64: undefined,
						...(observationToken === undefined ? {} : { observation_token: observationToken }),
					},
					null,
					2,
				),
			},
		],
	};
}

export function observedActionResult(
	state: AppState,
	contextUnchanged: boolean,
	observationToken?: string,
): ToolResult {
	const observationStatus = contextUnchanged ? axObservationStatus(state) : "context-changed";
	return {
		content: [
			stateImage(state),
			{
				type: "text",
				text: JSON.stringify(
					{
						...state,
						screenshotBase64: undefined,
						actionDispatched: true,
						observationStatus,
						paused: observationToken === undefined,
						needsExplicitObservation: observationToken === undefined,
						...(observationToken === undefined ? {} : { observation_token: observationToken }),
					},
					null,
					2,
				),
			},
		],
	};
}

export function postActionErrorResult(error: unknown): ToolResult {
	return textResult(
		JSON.stringify(
			{
				actionDispatched: true,
				observationStatus: "error",
				paused: true,
				needsExplicitObservation: true,
				error: error instanceof Error ? error.message : String(error),
			},
			null,
			2,
		),
	);
}

function stateImage(state: AppState): ToolContent {
	return {
		type: "image",
		data: state.screenshotBase64,
		mimeType: state.screenshotMimeType ?? "image/png",
	};
}

function axObservationStatus(state: AppState): "changed" | "unchanged" | "unavailable" {
	const summary = state.axChangeSummary;
	if (summary === undefined) {
		return "unavailable";
	}
	return summary.added + summary.removed + summary.changed === 0 ? "unchanged" : "changed";
}
