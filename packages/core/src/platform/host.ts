import type { ComputerInterface } from "../computer/interface.js";

export interface HostComputerOptions {
	display?: number;
}

export abstract class HostComputer implements ComputerInterface {
	abstract readonly capabilities: ComputerInterface["capabilities"];
	abstract screenshot(
		options?: import("../types/index.js").ScreenshotOptions,
	): Promise<import("../computer/interface.js").ScreenshotResult>;
	abstract move(position: import("../types/index.js").Point): Promise<void>;
	abstract click(position: import("../types/index.js").Point): Promise<void>;
	abstract rightClick(position: import("../types/index.js").Point): Promise<void>;
	abstract middleClick(position: import("../types/index.js").Point): Promise<void>;
	abstract doubleClick(position: import("../types/index.js").Point): Promise<void>;
	abstract type(text: string): Promise<void>;
	abstract key(key: string, options?: import("../types/index.js").KeyOptions): Promise<void>;
	abstract scroll(options: import("../types/index.js").ScrollOptions): Promise<void>;
	abstract drag(options: import("../types/index.js").DragOptions): Promise<void>;
	abstract getCursorPosition(): Promise<import("../types/index.js").Point>;
	abstract getScreenSize(): Promise<{ width: number; height: number }>;
	abstract close(): Promise<void>;
}
