import type { AppInfo, AppState } from "../accessibility/types.js";
import type {
	AppStateOptions,
	ComputerCapabilities,
	DragOptions,
	KeyOptions,
	Point,
	ScreenshotOptions,
	ScrollOptions,
} from "../types/index.js";

export interface ScreenshotResult {
	data: Buffer;
	mimeType: "image/png" | "image/jpeg";
	width: number;
	height: number;
}

export interface ComputerInterface {
	readonly capabilities: ComputerCapabilities;

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
	listApps(): Promise<AppInfo[]>;
	setValue(targetPid: number, elementIndex: number, value: string): Promise<void>;
	performAction(targetPid: number, elementIndex: number, action: string): Promise<void>;
	close(): Promise<void>;
}
