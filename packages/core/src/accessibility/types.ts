export interface AXTreeElement {
	id: number;
	role: string;
	label: string | null;
	value: string | null;
	/**
	 * Element bounds. When the screenshot is scoped to a single window
	 * ({@link AppState.windowBounds} is set), the frame is in that window
	 * screenshot's pixel space so it shares one coordinate system with the
	 * screenshot. Otherwise it is in global logical screen points.
	 */
	frame: { x: number; y: number; width: number; height: number };
	actions: string[];
	children: number[];
}

export interface DisplayInfo {
	width: number;
	height: number;
	scaleFactor: number;
}

export interface AxTreeChangeSummary {
	added: number;
	removed: number;
	changed: number;
}

/**
 * The element-level accessibility diff: the actual elements that were added,
 * removed, and changed between two snapshots. This is the token-efficient
 * observation the model reads to see *what* changed, not just *how much*
 * ({@link AxTreeChangeSummary}).
 */
export interface AxTreeChanges {
	added: AXTreeElement[];
	removed: AXTreeElement[];
	changed: Array<{ before: AXTreeElement; after: AXTreeElement }>;
}

/** One window of an app that input could target, as reported back on an observation. */
export interface WindowInventoryEntry {
	readonly id: number;
	readonly title: string;
	readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface AppState {
	app: string;
	bundleId: string;
	pid: number;
	frontmost: boolean;
	axAvailable: boolean;
	elements: AXTreeElement[];
	screenshotBase64: string;
	screenshotWidth: number;
	screenshotHeight: number;
	screenshotMimeType?: "image/png" | "image/jpeg";
	display: DisplayInfo;
	/**
	 * Key of the observation these element ids came from. A caller that intends to act on an id
	 * passes this back so the driver can prove the ids are still the current observation rather
	 * than ones an earlier walk produced.
	 */
	observationKey?: string;
	/**
	 * Whether the accessibility tree or the screenshot is the more reliable
	 * perception channel for this screen ("ax" or "image"). When "image", the
	 * tree is sparse or image-dominated, so prefer the screenshot (vision).
	 */
	contentKind?: import("./content-kind.js").ContentKind;
	axChangeSummary?: AxTreeChangeSummary;
	/**
	 * True when `elements` was intentionally omitted from this result because a
	 * diff-only observation replaced the tree with {@link axChanges}. Consumers that
	 * need element ids must ask for a full observation.
	 */
	treeOmitted?: boolean;
	/**
	 * True when the accessibility walk stopped at the element budget, so `elements`
	 * is a prefix of the real tree rather than all of it. Raise `max_elements` to see
	 * the rest.
	 */
	elementsTruncated?: boolean;
	/**
	 * The element-level diff from the previous `get_app_state` call for this app,
	 * present when a prior snapshot exists. Prefer this over re-reading the full
	 * `elements` tree when you only need to know what changed.
	 */
	axChanges?: AxTreeChanges;
	appInstructions?: string;
	/**
	 * Target window rect in global logical screen points, present when the
	 * screenshot is scoped to a single app window. Screenshot pixel coordinates
	 * map onto the screen through this rect.
	 */
	windowBounds?: { x: number; y: number; width: number; height: number };
	/** WindowServer id of the window this observation was scoped to. */
	windowId?: number;
	/** Title of that window, when the window server reports one. */
	windowTitle?: string;
	/**
	 * Every window of this app that input could target, present when there is more than one,
	 * so a caller can pick explicitly instead of relying on the driver's default choice.
	 */
	windowCandidates?: readonly WindowInventoryEntry[];
}

export interface SkyshotResult {
	appState: AppState;
	captureTimestampMs: number;
}

export interface AppInfo {
	name: string;
	bundleId: string;
	pid: number;
	isRunning: boolean;
	isFrontmost?: boolean;
	lastUsedDate?: string;
	useCount?: number;
}
