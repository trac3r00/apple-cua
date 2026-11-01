import type { HistoryEvent } from "./history-events.js";
import {
	DEFAULT_HISTORY_OBSERVATION_SETTINGS,
	type HistoryObservationContext,
	type HistoryObservationSettings,
	shouldObserve,
} from "./history-settings.js";
import type { HistorySegmentStore } from "./history-store.js";

export type HistoryRecorderState = "running" | "paused" | "stopped";

export type RecordOutcome = "recorded" | "suppressed" | "not_recording";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type UnstampedHistoryEvent = DistributiveOmit<HistoryEvent, "id">;

export interface HistoryRecorderOptions {
	readonly store: HistorySegmentStore;
	readonly settings?: HistoryObservationSettings;
	readonly now?: () => number;
}

export class HistoryRecorder {
	private state: HistoryRecorderState = "stopped";
	private settings: HistoryObservationSettings;
	private readonly store: HistorySegmentStore;
	private readonly now: () => number;
	private nextId = 1;

	constructor(options: HistoryRecorderOptions) {
		this.store = options.store;
		this.settings = options.settings ?? DEFAULT_HISTORY_OBSERVATION_SETTINGS;
		this.now = options.now ?? Date.now;
	}

	status(): { readonly state: HistoryRecorderState; readonly currentSegmentId: string | undefined } {
		return { state: this.state, currentSegmentId: this.store.currentSegmentId() };
	}

	getSettings(): HistoryObservationSettings {
		return this.settings;
	}

	updateSettings(settings: HistoryObservationSettings): void {
		this.settings = settings;
	}

	async start(): Promise<void> {
		const wasInactive = this.state !== "running";
		this.state = "running";
		if (wasInactive) {
			await this.store.append({
				id: this.nextId++,
				kind: "session.started",
				timestamp: new Date(this.now()).toISOString(),
			});
		}
	}

	pause(): void {
		if (this.state === "running") {
			this.state = "paused";
		}
	}

	async resume(): Promise<void> {
		if (this.state === "paused") {
			await this.start();
		}
	}

	stop(): void {
		this.state = "stopped";
	}

	async record(context: HistoryObservationContext, event: UnstampedHistoryEvent): Promise<RecordOutcome> {
		if (this.state !== "running") {
			return "not_recording";
		}
		if (!shouldObserve(context, this.settings)) {
			await this.store.recordSuppressed();
			return "suppressed";
		}
		await this.store.append({ ...event, id: this.nextId++ });
		await this.store.prune();
		return "recorded";
	}
}
