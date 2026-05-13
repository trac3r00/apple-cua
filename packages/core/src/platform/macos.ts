import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import type { DragOptions, KeyOptions, Point, ScreenshotOptions, ScrollOptions } from "../types/index.js";
import { HostComputer, type HostComputerOptions } from "./host.js";

const execFileAsync = promisify(execFile);

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
		const args = ["-x"];
		if (options?.region) {
			args.push("-R", `${options.region.x},${options.region.y},${options.region.width},${options.region.height}`);
		}
		args.push("-");

		const { stdout } = await execFileAsync("screencapture", args, {
			encoding: "buffer",
			maxBuffer: 50 * 1024 * 1024,
		});

		return {
			data: stdout,
			mimeType: "image/png",
			width: 0,
			height: 0,
		};
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
		const { stdout } = await execFileAsync(
			"osascript",
			["-e", 'tell application "Finder" to get bounds of window of desktop'],
			{ encoding: "utf8" },
		);
		const match = stdout.trim().match(/^(\d+),\s*(\d+),\s*(\d+),\s*(\d+)$/);
		if (!match) {
			throw new Error("Failed to parse screen size");
		}
		return {
			width: Number(match[3]) - Number(match[1]),
			height: Number(match[4]) - Number(match[2]),
		};
	}

	async close(): Promise<void> {
		// Nothing to clean up for host computer
	}
}
