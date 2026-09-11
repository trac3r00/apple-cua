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
	 * Whether the accessibility tree or the screenshot is the more reliable
	 * perception channel for this screen ("ax" or "image"). When "image", the
	 * tree is sparse or image-dominated, so prefer the screenshot (vision).
	 */
	contentKind?: import("./content-kind.js").ContentKind;
	axChangeSummary?: AxTreeChangeSummary;
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
