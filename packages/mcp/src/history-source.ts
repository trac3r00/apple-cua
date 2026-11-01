import {
	historyPaths,
	readHistorySettings,
	readHistoryState,
	segmentIdForTimestamp,
	writeHistorySettings,
	writeHistoryState,
} from "@apple-cua/core";
import type { HistoryStatus, HistoryToolSource } from "./history-tools.js";

export interface HistorySourceOptions {
	readonly stateDir: string;
	readonly retentionHours?: number;
	readonly now?: () => number;
}

export function createHistorySource(options: HistorySourceOptions): HistoryToolSource {
	const paths = historyPaths(options.stateDir);
	const retentionHours = options.retentionHours ?? 6;
	const now = options.now ?? Date.now;

	const status = (): HistoryStatus => {
		const state = readHistoryState(paths);
		return {
			state,
			eventStreamRootPath: paths.root,
			summariesPath: paths.summariesPath,
			retentionHours,
			...(state === "stopped" ? {} : { currentSegmentId: segmentIdForTimestamp(now()) }),
		};
	};

	return {
		status,
		getSettings: () => readHistorySettings(paths),
		updateSettings(settings) {
			writeHistorySettings(paths, settings);
			return readHistorySettings(paths);
		},
		pause() {
			if (readHistoryState(paths) === "running") {
				writeHistoryState(paths, "paused");
			}
		},
		resume() {
			if (readHistoryState(paths) === "paused") {
				writeHistoryState(paths, "running");
			}
		},
	};
}
