import type { HistoryObservationInput } from "./history-observation.js";
import { appStateToHistory } from "./history-observation.js";
import type { HistoryRecorder } from "./history-recorder.js";

export interface HistorySampler {
	sample(): Promise<HistoryObservationInput | undefined>;
}

export type CaptureTimer = (callback: () => void, milliseconds: number) => () => void;

const SYSTEM_TIMER: CaptureTimer = (callback, milliseconds) => {
	const handle = setInterval(callback, milliseconds);
	handle.unref();
	return () => clearInterval(handle);
};

export interface HistoryCaptureLoopOptions {
	readonly intervalMs?: number;
	readonly timer?: CaptureTimer;
	readonly onError?: (error: unknown) => void;
}

function focusKey(input: HistoryObservationInput): string {
	return `${input.bundleId}\u0000${input.windowId ?? ""}\u0000${input.windowTitle ?? ""}\u0000${input.url ?? ""}`;
}

export class HistoryCaptureLoop {
	private cancel: (() => void) | undefined;
	private lastKey: string | undefined;
	private readonly intervalMs: number;
	private readonly timer: CaptureTimer;
	private readonly onError: (error: unknown) => void;

	constructor(
		private readonly recorder: HistoryRecorder,
		private readonly sampler: HistorySampler,
		options: HistoryCaptureLoopOptions = {},
	) {
		this.intervalMs = options.intervalMs ?? 2000;
		this.timer = options.timer ?? SYSTEM_TIMER;
		this.onError = options.onError ?? (() => {});
	}

	start(): void {
		if (this.cancel === undefined) {
			this.cancel = this.timer(() => {
				this.tick().catch(this.onError);
			}, this.intervalMs);
		}
	}

	stop(): void {
		this.cancel?.();
		this.cancel = undefined;
		this.lastKey = undefined;
	}

	async tick(): Promise<void> {
		const input = await this.sampler.sample();
		if (input === undefined) {
			return;
		}
		const key = focusKey(input);
		if (key === this.lastKey) {
			return;
		}
		this.lastKey = key;
		const { context, event } = appStateToHistory(input);
		await this.recorder.record(context, event);
	}
}
