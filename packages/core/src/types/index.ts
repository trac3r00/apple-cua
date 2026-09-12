export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ScreenshotOptions {
	region?: Rect;
	targetSize?: Size;
	format?: "png" | "jpeg";
	quality?: number;
}

export interface AppStateOptions {
	screenshotSize?: Size;
	timeoutMs?: number;
	settleMs?: number;
	/**
	 * When true and a prior snapshot exists for the app, omit the full `elements`
	 * tree and return only the accessibility diff (`axChanges` + `axChangeSummary`),
	 * the token-efficient observation. Has no effect on the first snapshot, which
	 * always returns the full tree so element indices can be derived.
	 */
	diffOnly?: boolean;
	/** Require a visible target window instead of falling back to a full-display capture. */
	requireWindow?: boolean;
}

export interface KeyOptions {
	readonly modifiers?: ReadonlyArray<"command" | "option" | "control" | "shift" | "cmd" | "alt" | "ctrl">;
	readonly holdMilliseconds?: number;
}

export interface ScrollOptions {
	direction: "up" | "down" | "left" | "right";
	amount: number;
}

export interface SelectTextOptions {
	selection: "text" | "before" | "after";
	text?: string;
	prefix?: string;
	suffix?: string;
}

export interface DragOptions {
	from: Point;
	to: Point;
	duration?: number;
}

export interface ComputerCapabilities {
	supportsScreenshot: boolean;
	supportsInput: boolean;
	supportsAccessibility: boolean;
	supportsClipboard: boolean;
}
