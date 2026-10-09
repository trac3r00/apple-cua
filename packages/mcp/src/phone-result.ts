import type { MirroringObservation, MirroringText } from "@apple-cua/core";
import type { PhoneContextFailure } from "./phone-context.js";
import type { PhoneSearchOutcome } from "./phone-search.js";
import { type ToolResult, textResult } from "./tool-result.js";

function projectText(text: MirroringText): Record<string, unknown> {
	return { ...text, center: { x: text.x + text.width / 2, y: text.y + text.height / 2 } };
}

export function projectPhoneObservation(observation: MirroringObservation): Record<string, unknown> {
	return {
		state: observation.state,
		window: observation.window,
		image_size: { width: observation.imageWidth, height: observation.imageHeight },
		texts: observation.texts.map(projectText),
	};
}

function projectFailure(failure: PhoneContextFailure, scrolls: number): Record<string, unknown> {
	const dispatched = scrolls > 0 || failure.actionDispatched === true;
	return {
		...failure,
		...(dispatched ? { actionDispatched: true } : failure.inputAttempted ? {} : { actionDispatched: false }),
		effect: scrolls > 0 ? "partial" : dispatched || failure.inputAttempted ? "unverifiable" : "refused",
		paused: true,
		needsExplicitObservation: true,
	};
}

export function phoneFailureResult(failure: PhoneContextFailure): ToolResult {
	return { isError: true, ...textResult(JSON.stringify(projectFailure(failure, 0))) };
}

export function projectPhoneSearch(outcome: PhoneSearchOutcome, query: string): Record<string, unknown> {
	const { failure, search, observation } = outcome;
	const searchResult = { ...search, matches: search.matches.map(projectText) };
	if (failure !== undefined) {
		return {
			...projectFailure(failure, search.scrolls),
			search: searchResult,
		};
	}
	return {
		...projectPhoneObservation(observation),
		search: searchResult,
		actionDispatched: search.scrolls > 0,
		effect: search.found ? "confirmed" : search.reason === "no_progress" ? "suspected_noop" : "unverifiable",
		verification: { verified: search.found, query },
	};
}
