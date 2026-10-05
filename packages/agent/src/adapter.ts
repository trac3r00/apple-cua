import type { ActionSpace, Decision } from "./types.js";

export interface ExecutionResult {
	readonly status: "ran" | "refused" | "failed";
	readonly route: "accessibility" | "synthetic" | "none";
	readonly detail: string;
}

/** One observation, as the decision layer needs it: a table plus whatever the platform holds. */
export interface Observation<TState> {
	readonly space: ActionSpace;
	readonly state: TState;
}

/**
 * What the shared policy needs from a platform. macOS observes through the accessibility tree and
 * presses element ids; the phone observes OCR text and taps a string's centre. The policy above them
 * is identical, which is what lets one loop serve both.
 */
export interface PlatformAdapter<TState> {
	readonly platform: "macos" | "ios";
	observe(): Promise<Observation<TState>>;
	execute(observation: Observation<TState>, decision: Decision): Promise<ExecutionResult>;
}
