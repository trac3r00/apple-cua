import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import type { DragOptions, KeyOptions, Point, ScreenshotOptions, ScrollOptions } from "../types/index.js";
import { HostComputer, type HostComputerOptions } from "./host.js";
import { MacOSInputController } from "./macos-input.js";

const execFileAsync = promisify(execFile);

const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const PNG_MINIMUM_IHDR_LENGTH = 24;

export interface MacOSHostComputerOptions extends HostComputerOptions {
	defaultTargetPid?: number;
}

export class MacOSHostComputer extends HostComputer {
	readonly capabilities: ComputerInterface["capabilities"] = {
		supportsScreenshot: true,
		supportsInput: true,
		supportsAccessibility: true,
		supportsClipboard: true,
	};

	private readonly input: MacOSInputController;

	constructor(options: MacOSHostComputerOptions = {}) {
		super();
		this.input = new MacOSInputController(options.defaultTargetPid);
		// TODO: use options for display selection
		void options.display;
	}

	setTarget(pid?: number): void {
		this.input.setTarget(pid);
	}

	async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
		// `screencapture -` (stdout) returns 0 bytes on macOS Sequoia/Tahoe,
		// so we always route through a temp file and read it back.
		const tempPath = join(tmpdir(), `macos-cua-${randomUUID()}.png`);
		const args = ["-x"];
		if (options?.region) {
			args.push("-R", `${options.region.x},${options.region.y},${options.region.width},${options.region.height}`);
		}
		args.push(tempPath);
		try {
			await execFileAsync("screencapture", args, { encoding: "utf8" });
			const data = await readFile(tempPath);
			return {
				data,
				mimeType: "image/png",
				...parsePngDimensions(data),
			};
		} finally {
			await unlink(tempPath).catch(() => undefined);
		}
	}

	async move(position: Point): Promise<void> {
		await this.input.move(position);
	}

	async click(position: Point): Promise<void> {
		await this.input.click(position);
	}

	async rightClick(position: Point): Promise<void> {
		await this.input.click(position, "right");
	}

	async middleClick(position: Point): Promise<void> {
		await this.input.click(position, "middle");
	}

	async doubleClick(position: Point): Promise<void> {
		await this.input.doubleClick(position);
	}

	async type(text: string): Promise<void> {
		await this.input.typeText(text);
	}

	async key(key: string, options?: KeyOptions): Promise<void> {
		await this.input.pressKey(key, options);
	}

	async scroll(options: ScrollOptions): Promise<void> {
		await this.input.scroll(options);
	}

	async drag(options: DragOptions): Promise<void> {
		await this.input.drag(options);
	}

	async getCursorPosition(): Promise<Point> {
		return this.input.getCursorPosition();
	}

	async getScreenSize(): Promise<{ width: number; height: number }> {
		// `system_profiler SPDisplaysDataType` works without Accessibility or
		// Apple Events permissions, unlike `osascript` against Finder which can
		// hang forever waiting for an Automation grant.
		const { stdout } = await execFileAsync("system_profiler", ["SPDisplaysDataType"], {
			encoding: "utf8",
			timeout: 10_000,
		});
		const match = stdout.match(/Resolution:\s*(\d+)\s*[x×]\s*(\d+)/);
		if (!match) {
			throw new Error("Failed to parse screen size from system_profiler output");
		}
		const widthStr = match[1];
		const heightStr = match[2];
		if (widthStr === undefined || heightStr === undefined) {
			throw new Error("Failed to parse screen size from system_profiler output");
		}
		return {
			width: Number(widthStr),
			height: Number(heightStr),
		};
	}

	async close(): Promise<void> {
		this.input.close();
	}
}

export function parsePngDimensions(data: Buffer): { width: number; height: number } {
	if (data.byteLength < PNG_MINIMUM_IHDR_LENGTH || data.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
		throw new Error("Failed to parse PNG dimensions");
	}

	return {
		width: data.readUInt32BE(PNG_IHDR_WIDTH_OFFSET),
		height: data.readUInt32BE(PNG_IHDR_HEIGHT_OFFSET),
	};
}
