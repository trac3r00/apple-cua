import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import type { DragOptions, KeyOptions, Point, ScreenshotOptions, ScrollOptions } from "../types/index.js";
import { HostComputer, type HostComputerOptions } from "./host.js";
import { MacOSCuaHelper } from "./macos-helper.js";
import { MacOSInputController } from "./macos-input.js";

const execFileAsync = promisify(execFile);

const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const PNG_MINIMUM_IHDR_LENGTH = 24;
const FINDER_DESKTOP_BOUNDS_TIMEOUT_MILLISECONDS = 2_000;
const SYSTEM_PROFILER_TIMEOUT_MILLISECONDS = 10_000;

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
	private readonly helper: MacOSCuaHelper;

	constructor(options: MacOSHostComputerOptions = {}) {
		super();
		this.input = new MacOSInputController(options.defaultTargetPid);
		this.helper = new MacOSCuaHelper();
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
		try {
			return await this.helper.getLogicalScreenSize();
		} catch {
			return await getMacOSLogicalScreenSize();
		}
	}

	async getAppState(targetPid?: number): Promise<import("../accessibility/types.js").AppState> {
		void targetPid;
		throw new Error("Not implemented — requires cua-helper skyshot command (T10)");
	}

	async listApps(): Promise<import("../accessibility/types.js").AppInfo[]> {
		throw new Error("Not implemented — requires cua-helper skyshot command (T10)");
	}

	async close(): Promise<void> {
		this.input.close();
		this.helper.close();
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

export async function getMacOSLogicalScreenSize(): Promise<{ width: number; height: number }> {
	const finderSize = await getFinderDesktopBounds().catch(() => undefined);
	if (finderSize !== undefined) {
		return finderSize;
	}

	const result = await execFileAsync("system_profiler", ["SPDisplaysDataType"], {
		encoding: "utf8",
		timeout: SYSTEM_PROFILER_TIMEOUT_MILLISECONDS,
	});
	const stdout = execFileStdout(result);
	const systemProfilerSize = parseSystemProfilerLogicalScreenSize(stdout);
	if (systemProfilerSize === undefined) {
		throw new Error("Failed to parse logical screen size from system_profiler output");
	}
	return systemProfilerSize;
}

async function getFinderDesktopBounds(): Promise<{ width: number; height: number }> {
	const result = await execFileAsync(
		"osascript",
		["-e", 'tell application "Finder" to get bounds of window of desktop'],
		{
			encoding: "utf8",
			timeout: FINDER_DESKTOP_BOUNDS_TIMEOUT_MILLISECONDS,
		},
	);
	const bounds = parseFinderDesktopBounds(execFileStdout(result));
	if (bounds === undefined) {
		throw new Error("Failed to parse Finder desktop bounds");
	}
	return bounds;
}

export function parseFinderDesktopBounds(output: string): { width: number; height: number } | undefined {
	const match = output.match(
		/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
	);
	if (match === null) {
		return undefined;
	}
	const left = finiteNumber(match[1]);
	const top = finiteNumber(match[2]);
	const right = finiteNumber(match[3]);
	const bottom = finiteNumber(match[4]);
	if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
		return undefined;
	}
	return positiveSize(right - left, bottom - top);
}

export function parseSystemProfilerLogicalScreenSize(output: string): { width: number; height: number } | undefined {
	const uiLooksLike = parseFirstSize(output, /UI Looks like:\s*(\d+)\s*[x×]\s*(\d+)/i);
	if (uiLooksLike !== undefined) {
		return uiLooksLike;
	}

	const resolutionLines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^Resolution:/i.test(line));
	for (const line of resolutionLines) {
		if (/Retina/i.test(line)) {
			continue;
		}
		const size = parseFirstSize(line, /(\d+)\s*[x×]\s*(\d+)/);
		if (size !== undefined) {
			return size;
		}
	}

	for (const line of resolutionLines) {
		const sizes = Array.from(line.matchAll(/(\d+)\s*[x×]\s*(\d+)/g), sizeFromMatch).filter(
			(size) => size !== undefined,
		);
		const smallestSize = smallestScreenSize(sizes);
		if (smallestSize === undefined) {
			continue;
		}
		return sizes.length > 1 ? smallestSize : retinaLogicalFallback(smallestSize);
	}

	return undefined;
}

function parseFirstSize(output: string, expression: RegExp): { width: number; height: number } | undefined {
	const match = output.match(expression);
	if (match === null) {
		return undefined;
	}
	return sizeFromMatch(match);
}

function sizeFromMatch(match: RegExpMatchArray): { width: number; height: number } | undefined {
	const width = positiveNumber(match[1]);
	const height = positiveNumber(match[2]);
	if (width === undefined || height === undefined) {
		return undefined;
	}
	return { width: Math.round(width), height: Math.round(height) };
}

function positiveNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const numberValue = Number(value);
	return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function finiteNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : undefined;
}

function positiveSize(width: number, height: number): { width: number; height: number } | undefined {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return undefined;
	}
	return { width: Math.round(width), height: Math.round(height) };
}

function execFileStdout(result: { readonly stdout: string | Buffer } | string | Buffer): string {
	if (typeof result === "string") {
		return result;
	}
	if (Buffer.isBuffer(result)) {
		return result.toString("utf8");
	}
	return Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
}

function smallestScreenSize(
	sizes: ReadonlyArray<{ readonly width: number; readonly height: number }>,
): { width: number; height: number } | undefined {
	let smallest: { width: number; height: number } | undefined;
	for (const size of sizes) {
		if (smallest === undefined || size.width * size.height < smallest.width * smallest.height) {
			smallest = { width: size.width, height: size.height };
		}
	}
	return smallest;
}

function retinaLogicalFallback(size: { readonly width: number; readonly height: number }): {
	width: number;
	height: number;
} {
	if (size.width % 2 === 0 && size.height % 2 === 0) {
		return { width: size.width / 2, height: size.height / 2 };
	}
	return { width: size.width, height: size.height };
}
