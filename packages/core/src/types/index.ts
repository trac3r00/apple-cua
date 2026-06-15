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
