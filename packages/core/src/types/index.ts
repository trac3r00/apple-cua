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
	/**
	 * Capture viewport dimensions are still reported when false, but no image is
	 * captured, so element frames and coordinate mapping stay valid while the
	 * observation costs no screenshot time or image tokens. Default true.
	 */
	includeScreenshot?: boolean;
	/**
	 * Skip the accessibility walk and the settle wait, and return the capture only: the cheapest
	 * observation, for previews and for callers that already hold the tree. No element ids are
	 * produced, so the answer cannot authorize element actions. Default true.
	 */
	includeAccessibilityTree?: boolean;
	/** Cap the number of accessibility elements walked. Defaults to the driver's own cap. */
	maxElements?: number;
	/** Include the application menu bar in the tree. Default false for window-scoped observations. */
	includeMenuBar?: boolean;
	/**
	 * Observe this exact WindowServer window id instead of the app's focused window. Use a
	 * candidate id from a previous observation when an app has several windows.
	 */
	windowId?: number;
	/**
	 * Observe only the subtree rooted at this element index from the previous observation of
	 * the same app. Element ids restart at 0 inside the subtree, so a huge tree can be
	 * explored one branch at a time instead of being truncated or dumped whole.
	 */
	subtreeOf?: number;
}

/**
 * How input reaches its target: "attended" delivery may briefly lease the foreground for a
 * targeted action (reported as foreground delivery), "background" posts to the target process
 * without touching the frontmost app.
 */
export type InputDelivery = "attended" | "background";

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
