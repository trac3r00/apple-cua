import type { AppInfo, AppState } from "../accessibility/types.js";
import type {
	AppStateOptions,
	ComputerCapabilities,
	DragOptions,
	InputDelivery,
	KeyOptions,
	Point,
	ScreenshotOptions,
	ScrollOptions,
	SelectTextOptions,
} from "../types/index.js";
import type { ScreenshotViewport } from "./viewport.js";

export interface ScreenshotResult {
	data: Buffer;
	mimeType: "image/png" | "image/jpeg";
	width: number;
	height: number;
}

export interface ComputerInterface {
	readonly capabilities: ComputerCapabilities;
	/**
	 * How this computer delivers input: "attended" may lease the foreground for a targeted
	 * action, "background" posts to the target process without touching the frontmost app.
	 * Platforms that do not distinguish the two leave it undefined.
	 */
	readonly delivery?: InputDelivery;

	screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
	setTarget(pid?: number): void;
	move(position: Point): Promise<void>;
	click(position: Point): Promise<void>;
	rightClick(position: Point): Promise<void>;
	middleClick(position: Point): Promise<void>;
	doubleClick(position: Point): Promise<void>;
	type(text: string): Promise<void>;
	key(key: string, options?: KeyOptions): Promise<void>;
	scroll(options: ScrollOptions): Promise<void>;
	drag(options: DragOptions): Promise<void>;
	getCursorPosition(): Promise<Point>;
	getScreenSize(): Promise<{ width: number; height: number }>;
	getAppState(targetPid?: number, options?: AppStateOptions): Promise<AppState>;
	/**
	 * Refuses when `observationKey` is not the observation currently backing element ids for this
	 * app. Callers hold the key from the state whose ids they are about to use; this is what stops
	 * an index outliving the tree it was derived from and silently naming another control.
	 */
	assertObservationCurrent(targetPid: number, observationKey: string): void;
	/**
	 * Viewport that maps the most recent `get_app_state` window screenshot for
	 * `targetPid` onto global logical screen coordinates, or undefined when no
	 * window-scoped screenshot is available.
	 */
	getScreenshotViewport(targetPid: number): Promise<ScreenshotViewport | undefined>;
	listApps(): Promise<AppInfo[]>;
	setValue(targetPid: number, elementIndex: number, value: string): Promise<void>;
	selectText(targetPid: number, elementIndex: number, options: SelectTextOptions): Promise<void>;
	performAction(targetPid: number, elementIndex: number, action: string): Promise<void>;
	pressAtPosition(targetPid: number, position: Point): Promise<boolean>;
	typeIntoFocused(targetPid: number, text: string): Promise<boolean>;
	close(): Promise<void>;
}
