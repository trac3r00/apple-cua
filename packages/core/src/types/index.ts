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
	/**
	 * A read that only answers a question while an action is in flight (a scroll-until-found check): it
	 * still renumbers the accessibility ids it returns, but it does not become the app's input observation
	 * or the baseline later diffs compare against, and it leaves the overlay cursor alone.
	 */
	probe?: boolean;
	/**
	 * Walk an outline, table or list by the rows it shows instead of every row it holds, so a long list costs a
	 * page of rows. Element ids number what was walked; a list that does not name its shown rows is walked whole.
	 */
	visibleOnly?: boolean;
}

/**
 * How input reaches its target: "attended" delivery may briefly lease the foreground for a
 * targeted action (reported as foreground delivery), "background" posts to the target process
 * without touching the frontmost app.
 */
export type InputDelivery = "attended" | "background";

/** A modifier key a person can hold; the short names are aliases for the long ones. */
export type KeyModifierName = "command" | "option" | "control" | "shift" | "cmd" | "alt" | "opt" | "ctrl";

export interface KeyOptions {
	readonly modifiers?: ReadonlyArray<KeyModifierName>;
	readonly holdMilliseconds?: number;
}

/** Modifier keys held for the whole of a click, drag or scroll, like a person holding Command while clicking. */
export interface PointerOptions {
	readonly modifiers?: ReadonlyArray<KeyModifierName>;
}

export interface ScrollOptions extends PointerOptions {
	direction: "up" | "down" | "left" | "right";
	amount: number;
	/** Screen point the wheel event is delivered at; without it the event carries the real cursor position. */
	position?: Point;
}

export interface SelectTextOptions {
	selection: "text" | "before" | "after";
	text?: string;
	prefix?: string;
	suffix?: string;
}

export interface DragOptions extends PointerOptions {
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
