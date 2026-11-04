import { homedir } from "node:os";
import { join } from "node:path";
import {
	historyPaths,
	readHistorySettings,
	readHistoryState,
	readSkillDescriptions,
	saveHistorySkillDraft,
	segmentIdForTimestamp,
	skillDescriptionsEnabled,
	suggestHistorySkills,
	writeHistorySettings,
	writeHistoryState,
} from "@opencua/core";
import type { HistoryStatus, HistoryToolSource } from "./history-tools.js";

export interface HistorySourceOptions {
	readonly stateDir: string;
	readonly retentionHours?: number;
	readonly now?: () => number;
	readonly skillsDirectory?: string;
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
		suggestSkills: ({ limit }) => suggestHistorySkills(paths.root, { limit }),
		skillDescriptions: async () =>
			(await skillDescriptionsEnabled(paths.root)) ? await readSkillDescriptions(paths.root) : {},
		saveSkill: (draft) =>
			saveHistorySkillDraft(options.skillsDirectory ?? join(homedir(), ".agents", "skills"), draft),
	};
}
