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
	display: DisplayInfo;
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
}
