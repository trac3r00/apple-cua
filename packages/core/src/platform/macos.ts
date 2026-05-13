import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import type { DragOptions, KeyOptions, Point, ScreenshotOptions, ScrollOptions } from "../types/index.js";
import { HostComputer, type HostComputerOptions } from "./host.js";

const execFileAsync = promisify(execFile);

const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const PNG_MINIMUM_IHDR_LENGTH = 24;

export class MacOSHostComputer extends HostComputer {
	readonly capabilities: ComputerInterface["capabilities"] = {
		supportsScreenshot: true,
		supportsInput: true,
		supportsAccessibility: true,
		supportsClipboard: true,
	};

	constructor(options: HostComputerOptions = {}) {
		super();
		// TODO: use options for display selection
		void options;
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

	async click(position: Point): Promise<void> {
		await execFileAsync("cliclick", [`c:${position.x},${position.y}`]);
	}

	async doubleClick(position: Point): Promise<void> {
		await execFileAsync("cliclick", [`dc:${position.x},${position.y}`]);
	}

	async type(text: string): Promise<void> {
		await execFileAsync("cliclick", [`t:${text}`]);
	}

	async key(key: string, options?: KeyOptions): Promise<void> {
		const modifiers =
			options?.modifiers?.map((m) => {
				switch (m) {
					case "command":
						return "cmd";
					case "option":
						return "alt";
					case "control":
						return "ctrl";
					case "shift":
						return "shift";
				}
			}) ?? [];

		const keyCombo = modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;
		await execFileAsync("cliclick", [`kp:${keyCombo}`]);
	}

	async scroll(options: ScrollOptions): Promise<void> {
		const direction = options.direction === "up" || options.direction === "left" ? "-" : "";
		const amount = String(options.amount);
		await execFileAsync("cliclick", [`scroll:${direction}${amount}`]);
	}

	async drag(options: DragOptions): Promise<void> {
		await execFileAsync("cliclick", [
			`dd:${options.from.x},${options.from.y}`,
			`dm:${options.to.x},${options.to.y}`,
			`du:${options.to.x},${options.to.y}`,
		]);
	}

	async getCursorPosition(): Promise<Point> {
		const { stdout } = await execFileAsync("cliclick", ["p"], { encoding: "utf8" });
		const match = stdout.trim().match(/^(\d+),(\d+)$/);
		if (!match) {
			throw new Error("Failed to parse cursor position");
		}
		return { x: Number(match[1]), y: Number(match[2]) };
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
		// Nothing to clean up for host computer
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
