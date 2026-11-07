import type { HistoryAx } from "./history-events.js";
import type { UnstampedHistoryEvent } from "./history-recorder.js";
import type { HistoryObservationContext } from "./history-settings.js";

export interface HistoryObservationInput {
	readonly app: string;
	readonly bundleId: string;
	readonly pid: number;
	readonly timestamp: string;
	readonly windowId?: number;
	readonly windowTitle?: string;
	readonly url?: string;
	readonly privateBrowsing?: boolean;
	readonly axText?: string;
	readonly axMode?: HistoryAx["mode"];
}

export function appStateToHistory(input: HistoryObservationInput): {
	readonly context: HistoryObservationContext;
	readonly event: UnstampedHistoryEvent;
} {
	const ax: HistoryAx | undefined =
		input.axText === undefined ? undefined : { mode: input.axMode ?? "fullTree", text: input.axText };

	return {
		context: {
			bundleId: input.bundleId,
			...(input.url === undefined ? {} : { url: input.url }),
			...(input.privateBrowsing === undefined ? {} : { privateBrowsing: input.privateBrowsing }),
		},
		event: {
			kind: "window.changed",
			timestamp: input.timestamp,
			app: { bundleIdentifier: input.bundleId, name: input.app, processIdentifier: input.pid },
			window: {
				windowID: input.windowId ?? 0,
				title: input.windowTitle ?? "",
				...(input.url === undefined ? {} : { url: input.url }),
			},
			...(ax === undefined ? {} : { ax }),
		},
	};
}
