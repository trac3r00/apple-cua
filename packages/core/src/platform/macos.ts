import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AXTreeElement, AppInfo, AppState } from "../accessibility/types.js";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import { type ScreenshotViewport, resolveWindowScreenshotSize, screenRectToScreenshot } from "../computer/viewport.js";
import type {
	AppStateOptions,
	DragOptions,
	KeyOptions,
	Point,
	ScreenshotOptions,
	ScrollOptions,
} from "../types/index.js";
import { HostComputer, type HostComputerOptions } from "./host.js";
import {
	extractAccessibilityTree,
	performActionByIndex,
	pressElementAtScreenPoint,
	setValueByIndex,
	typeIntoFocusedAXElement,
} from "./macos-ffi/accessibility.js";
import { captureMainDisplayPng, getMainDisplayLogicalSize } from "./macos-ffi/screenshot.js";
import { MacOSInputController } from "./macos-input.js";

const execFileAsync = promisify(execFile);

const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_IHDR_WIDTH_OFFSET = 16;
const PNG_IHDR_HEIGHT_OFFSET = 20;
const PNG_MINIMUM_IHDR_LENGTH = 24;
const FINDER_DESKTOP_BOUNDS_TIMEOUT_MILLISECONDS = 2_000;
const SYSTEM_PROFILER_TIMEOUT_MILLISECONDS = 10_000;
const SCREENSHOT_TIMEOUT_MILLISECONDS = 10_000;
const LIST_APPS_TIMEOUT_MILLISECONDS = 20_000;
const SCREENSHOT_MAX_BUFFER_BYTES = 100 * 1024 * 1024;
const DEFAULT_APP_STATE_SETTLE_MILLISECONDS = 300;

export interface RunningAppInfo extends AppInfo {
	readonly isActive: boolean;
}

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
	private readonly lastViewportByPid = new Map<number, ScreenshotViewport>();

	constructor(options: MacOSHostComputerOptions = {}) {
		super();
		this.input = new MacOSInputController(options.defaultTargetPid);
		// TODO: use options for display selection
		void options.display;
	}

	setTarget(pid?: number): void {
		this.input.setTarget(pid);
	}

	async rememberTargetWindow(pid: number): Promise<void> {
		await this.input.rememberTargetWindow(pid);
	}

	async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
		return this.captureScreenshot(options);
	}

	private async captureScreenshot(options?: ScreenshotOptions, windowId?: number): Promise<ScreenshotResult> {
		if (options?.region) {
			throw new Error("Region screenshots are not supported by the macOS screenshot fallback yet");
		}
		const size = options?.targetSize ?? (await this.getScreenSize());
		const data = await captureMacOSScreenshot(size, windowId);
		const dimensions = parsePngDimensions(data);
		return {
			data,
			mimeType: "image/png",
			width: dimensions.width,
			height: dimensions.height,
		};
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
			return getMainDisplayLogicalSize();
		} catch {
			return await getMacOSLogicalScreenSize();
		}
	}

	async getAppState(targetPid?: number, options?: AppStateOptions): Promise<AppState> {
		const settleMs = options?.settleMs ?? DEFAULT_APP_STATE_SETTLE_MILLISECONDS;
		if (settleMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, settleMs));
		}
		const apps = await getRunningMacOSApps();
		const app = resolveTargetApp(apps, targetPid);
		const targetWindow = await this.input.rememberTargetWindow(app.pid);
		// Scope the screenshot to the target window at its own aspect ratio (capped),
		// so the model sees an undistorted window image and coordinates invert cleanly.
		// Without a target window, fall back to the full display.
		const size =
			options?.screenshotSize ??
			(targetWindow !== undefined ? resolveWindowScreenshotSize(targetWindow.bounds) : await this.getScreenSize());
		const screenshot = await this.captureScreenshot({ targetSize: size }, targetWindow?.id);
		const tree = extractAccessibilityTree(app.pid);

		let elements = tree.elements;
		let windowBounds: ScreenshotViewport["windowBounds"] | undefined;
		if (targetWindow !== undefined) {
			const viewport: ScreenshotViewport = {
				windowBounds: { ...targetWindow.bounds },
				screenshotWidth: screenshot.width,
				screenshotHeight: screenshot.height,
			};
			this.lastViewportByPid.set(app.pid, viewport);
			windowBounds = viewport.windowBounds;
			elements = remapElementFramesToScreenshot(tree.elements, viewport);
		} else {
			this.lastViewportByPid.delete(app.pid);
		}

		return {
			app: app.name,
			bundleId: app.bundleId,
			pid: app.pid,
			frontmost: app.isActive,
			axAvailable: tree.axAvailable,
			elements,
			screenshotBase64: screenshot.data.toString("base64"),
			screenshotWidth: screenshot.width,
			screenshotHeight: screenshot.height,
			...(windowBounds !== undefined ? { windowBounds } : {}),
		};
	}

	async getScreenshotViewport(targetPid: number): Promise<ScreenshotViewport | undefined> {
		const stored = this.lastViewportByPid.get(targetPid);
		if (stored !== undefined) {
			return stored;
		}
		// No prior get_app_state this session: derive a viewport from the current
		// target window so a click still maps onto the right screen region.
		const targetWindow = await this.input.rememberTargetWindow(targetPid);
		if (targetWindow === undefined) {
			return undefined;
		}
		const size = resolveWindowScreenshotSize(targetWindow.bounds);
		return {
			windowBounds: { ...targetWindow.bounds },
			screenshotWidth: size.width,
			screenshotHeight: size.height,
		};
	}

	async listApps(): Promise<AppInfo[]> {
		return (await getRunningMacOSApps()).map(({ bundleId, name, pid }) => ({
			bundleId,
			name,
			pid,
			isRunning: true,
		}));
	}

	async setValue(targetPid: number, elementIndex: number, value: string): Promise<void> {
		setValueByIndex(targetPid, elementIndex, value);
	}

	async performAction(targetPid: number, elementIndex: number, action: string): Promise<void> {
		performActionByIndex(targetPid, elementIndex, action);
	}

	async pressAtPosition(targetPid: number, position: Point): Promise<boolean> {
		return pressElementAtScreenPoint(targetPid, position.x, position.y);
	}

	async typeIntoFocused(targetPid: number, text: string): Promise<boolean> {
		return typeIntoFocusedAXElement(targetPid, text);
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

export async function captureMacOSScreenshot(
	targetSize: {
		readonly width: number;
		readonly height: number;
	},
	windowId?: number,
): Promise<Buffer> {
	if (!Number.isSafeInteger(targetSize.width) || !Number.isSafeInteger(targetSize.height)) {
		throw new Error("requested screenshot dimensions must be integers");
	}
	if (targetSize.width <= 0 || targetSize.height <= 0) {
		throw new Error("requested screenshot dimensions must be positive");
	}
	if (windowId !== undefined && (!Number.isSafeInteger(windowId) || windowId <= 0)) {
		throw new Error("windowId must be a positive integer");
	}

	if (windowId === undefined) {
		const captured = captureMainDisplayPng(targetSize.width, targetSize.height);
		parsePngDimensions(captured.data);
		return captured.data;
	}

	return captureWindowScreenshotViaCli(targetSize, windowId);
}

async function captureWindowScreenshotViaCli(
	targetSize: { readonly width: number; readonly height: number },
	windowId: number,
): Promise<Buffer> {
	const captureCommand = `screencapture -x -o -l ${windowId} -t png "$tmp"`;
	const script = [
		"set -eu",
		'tmp=$(mktemp "${TMPDIR:-/tmp}/macos-cua-shot.XXXXXX")',
		'out=""',
		'cleanup() { rm -f "$tmp"; if [ -n "$out" ]; then rm -f "$out"; fi; }',
		"trap cleanup EXIT",
		captureCommand,
		'out=$(mktemp "${TMPDIR:-/tmp}/macos-cua-shot-resized.XXXXXX")',
		'sips -z "$2" "$1" "$tmp" --out "$out" >/dev/null',
		'cat "$out"',
	].join("\n");
	const result = await execFileAsync(
		"sh",
		["-c", script, "macos-cua-screenshot", String(targetSize.width), String(targetSize.height)],
		{
			encoding: "buffer",
			maxBuffer: SCREENSHOT_MAX_BUFFER_BYTES,
			timeout: SCREENSHOT_TIMEOUT_MILLISECONDS,
		},
	);
	const data = execFileStdoutBuffer(result);
	parsePngDimensions(data);
	return data;
}

export async function getRunningMacOSApps(): Promise<RunningAppInfo[]> {
	const result = await execFileAsync("osascript", ["-l", "JavaScript", "-e", LIST_APPS_JXA], {
		encoding: "utf8",
		timeout: LIST_APPS_TIMEOUT_MILLISECONDS,
	});
	return parseRunningApps(execFileStdout(result));
}

export function parseRunningApps(output: string): RunningAppInfo[] {
	const parsed: unknown = JSON.parse(output);
	if (!Array.isArray(parsed)) {
		throw new Error("list apps output must be a JSON array");
	}
	return parsed.map(parseRunningApp).sort((left, right) => left.name.localeCompare(right.name));
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

function execFileStdoutBuffer(result: { readonly stdout: string | Buffer } | string | Buffer): Buffer {
	if (Buffer.isBuffer(result)) {
		return result;
	}
	if (typeof result === "string") {
		return Buffer.from(result, "binary");
	}
	return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout, "binary");
}

function remapElementFramesToScreenshot(
	elements: readonly AXTreeElement[],
	viewport: ScreenshotViewport,
): AXTreeElement[] {
	return elements.map((element) => ({
		...element,
		frame: screenRectToScreenshot(element.frame, viewport),
	}));
}

function resolveTargetApp(apps: readonly RunningAppInfo[], targetPid: number | undefined): RunningAppInfo {
	if (targetPid !== undefined) {
		const app = apps.find((candidate) => candidate.pid === targetPid);
		if (app === undefined) {
			throw new Error(`No running app matched pid ${targetPid}`);
		}
		return app;
	}
	const frontmost = apps.find((candidate) => candidate.isActive);
	if (frontmost === undefined) {
		throw new Error("No frontmost application available");
	}
	return frontmost;
}

function parseRunningApp(value: unknown): RunningAppInfo {
	if (!isRecord(value)) {
		throw new Error("running app entry must be an object");
	}
	const name = stringField(value, "name");
	const pid = numberField(value, "pid");
	const bundleId = stringField(value, "bundleId");
	const isActive = booleanField(value, "isActive");
	return { name, pid, bundleId, isActive, isRunning: true };
}

function stringField(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string") {
		throw new Error(`running app ${key} must be a string`);
	}
	return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
	const value = record[key];
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`running app ${key} must be a positive integer`);
	}
	return value;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
	const value = record[key];
	if (typeof value !== "boolean") {
		throw new Error(`running app ${key} must be a boolean`);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

const LIST_APPS_JXA = `
const systemEvents = Application("System Events");
function readString(value) {
	try {
		const result = value();
		return typeof result === "string" ? result : "";
	} catch {
		return "";
	}
}
JSON.stringify(
	systemEvents.applicationProcesses.whose({ backgroundOnly: false })()
		.map((process) => ({
			name: readString(process.name),
			bundleId: readString(process.bundleIdentifier),
			pid: process.unixId(),
			isActive: process.frontmost(),
		}))
		.filter((app) => app.name.length > 0 && Number.isInteger(app.pid) && app.pid > 0 && app.bundleId.length > 0),
);
`;

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
