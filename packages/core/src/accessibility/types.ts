export interface AXTreeElement {
	id: number;
	role: string;
	label: string | null;
	value: string | null;
	frame: { x: number; y: number; width: number; height: number };
	actions: string[];
	children: number[];
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
