import type { ComputerInterface } from "../computer/interface.js";

export interface VMComputerOptions {
	vmType: "qemu" | "virtualbox" | "vmware" | "parallels";
	vmId: string;
}

export abstract class VMComputer implements ComputerInterface {
	abstract readonly capabilities: ComputerInterface["capabilities"];
	abstract screenshot(
		options?: import("../types/index.js").ScreenshotOptions,
	): Promise<import("../computer/interface.js").ScreenshotResult>;
	abstract setTarget(pid?: number): void;
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
	abstract getAppState(
		targetPid?: number,
		options?: import("../types/index.js").AppStateOptions,
	): Promise<import("../accessibility/types.js").AppState>;
	abstract getScreenshotViewport(
		targetPid: number,
	): Promise<import("../computer/viewport.js").ScreenshotViewport | undefined>;
	abstract listApps(): Promise<import("../accessibility/types.js").AppInfo[]>;
	abstract setValue(targetPid: number, elementIndex: number, value: string): Promise<void>;
	abstract selectText(
		targetPid: number,
		elementIndex: number,
		options: import("../types/index.js").SelectTextOptions,
	): Promise<void>;
	abstract performAction(targetPid: number, elementIndex: number, action: string): Promise<void>;
	abstract pressAtPosition(targetPid: number, position: import("../types/index.js").Point): Promise<boolean>;
	abstract typeIntoFocused(targetPid: number, text: string): Promise<boolean>;
	abstract close(): Promise<void>;
}
