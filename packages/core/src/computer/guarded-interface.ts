import type { Rect } from "../types/index.js";
import type { ComputerInterface } from "./interface.js";

export interface InputObservation {
	readonly generation: number;
	readonly pid: number;
	readonly bundleId: string;
	readonly windowId: number;
	readonly windowBounds: Rect;
	readonly screenshotViewport: {
		readonly width: number;
		readonly height: number;
		readonly bounds: Rect;
	};
	readonly observedElementIds: ReadonlySet<number>;
}

export type PreflightResult =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly reason:
				| "app-not-frontmost"
				| "app-not-approved"
				| "url-blocked"
				| "url-unavailable"
				| "window-missing"
				| "window-changed"
				| "window-bounds-changed"
				| "observation-replaced";
	  };

export interface PreflightOptions {
	/**
	 * Refuse when the window moved or resized since the observation. Only input that maps observed
	 * screenshot coordinates onto the screen depends on the bounds; element, keyboard and menu input
	 * does not, and would otherwise be refused while a window is still animating into place.
	 * Defaults to true.
	 */
	readonly requireSameBounds?: boolean;
}

export interface GuardedComputerInterface extends ComputerInterface {
	getInputObservation(targetPid: number): InputObservation | undefined;
	preflightInput(expected: InputObservation, options?: PreflightOptions): Promise<PreflightResult>;
}
