import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { classifyContentKind } from "../accessibility/content-kind.js";
import { diffAxTreeChanges, diffAxTreesByKey } from "../accessibility/diff.js";
import { normalizeAxTree } from "../accessibility/normalize.js";
import type { AXTreeElement, AppInfo, AppState, DisplayInfo } from "../accessibility/types.js";
import type { WindowInventoryEntry } from "../accessibility/types.js";
import { resolveAppInstructions } from "../app-instructions/index.js";
import { resolveDisplayMetadata } from "../computer/display-metadata.js";
import type { InputObservation, PreflightResult } from "../computer/guarded-interface.js";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import { type ScreenshotViewport, resolveWindowScreenshotSize, screenRectToScreenshot } from "../computer/viewport.js";
import type { AppApprovalStore } from "../permission/app-approval.js";
import { blockedUrl, browserUrlScript, isBrowserBundle } from "../permission/url-blocklist.js";
import type {
	AppStateOptions,
	DragOptions,
	KeyOptions,
	Point,
	Rect,
	ScreenshotOptions,
	ScrollOptions,
	SelectTextOptions,
} from "../types/index.js";
import { type RunningAppInfo, collectAppUsage, getRunningMacOSApps } from "./app-list.js";
import { execFileStdout, execFileStdoutBuffer } from "./exec-util.js";
import { HostComputer, type HostComputerOptions } from "./host.js";
import { parseImageDimensions, parsePngDimensions, sniffImageMimeType } from "./image-format.js";
import {
	extractAccessibilityTree,
	focusedWindowIdForPid,
	performActionByIndex,
	pressElementAtScreenPoint,
	releaseAccessibilitySnapshot,
	setValueByIndex,
	typeIntoFocusedAXElement,
} from "./macos-ffi/accessibility.js";
import type { AccessibilityTreeOptions } from "./macos-ffi/accessibility.js";
import { type PointerOverlay, createCursorOverlay } from "./macos-ffi/cursor-overlay.js";
import { createDisplaySleepAssertion } from "./macos-ffi/power.js";
import {
	captureDisplayPng,
	captureDisplayRegionPng,
	captureWindowImage,
	getMainDisplayId,
	getMainDisplayLogicalSize,
	getMainDisplayNativePixelSize,
} from "./macos-ffi/screenshot.js";
import { selectTextByIndex } from "./macos-ffi/select-text.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";
import { MacOSInputController } from "./macos-input.js";
import { openWindowsForTargeting } from "./macos-open-windows.js";
import { selectSystemEventsTargetWindow } from "./macos-window-target-fallback.js";
import { selectVisibleTargetWindow, visibleWindowsForPid } from "./macos-window-target.js";

const execFileAsync = promisify(execFile);

const FINDER_DESKTOP_BOUNDS_TIMEOUT_MILLISECONDS = 2_000;
const SYSTEM_PROFILER_TIMEOUT_MILLISECONDS = 10_000;
const SCREENSHOT_TIMEOUT_MILLISECONDS = 10_000;
const SCREENSHOT_MAX_BUFFER_BYTES = 100 * 1024 * 1024;
const DEFAULT_APP_STATE_SETTLE_MILLISECONDS = 300;
/** Interval between accessibility-tree polls while waiting for the UI to settle. */
const UI_SETTLE_POLL_MILLISECONDS = 40;
/** Element budget for settle polls: enough to see the visible tree change, far cheaper to walk. */
const SETTLE_SIGNATURE_MAX_ELEMENTS = 250;

export interface MacOSHostComputerOptions extends HostComputerOptions {
	defaultTargetPid?: number;
	overlay?: PointerOverlay;
	appApproval?: AppApprovalStore;
	urlBlocklist?: readonly string[];
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
	private readonly lastAxTreeByPid = new Map<
		number,
		{ readonly elements: AXTreeElement[]; readonly truncated: boolean; readonly walkKey: string }
	>();
	private readonly observedAxPids = new Set<number>();
	private readonly appApproval: AppApprovalStore | undefined;
	private readonly urlBlocklist: readonly string[];
	private readonly overlay: PointerOverlay;
	private readonly displayId: number | undefined;
	private readonly highlightedApps = new Set<number>();
	private readonly inputObservations = new Map<number, InputObservation>();
	private observationGeneration = 0;

	constructor(options: MacOSHostComputerOptions = {}) {
		super();
		this.appApproval = options.appApproval;
		this.urlBlocklist = options.urlBlocklist ?? [];
		this.overlay = options.overlay ?? createCursorOverlay();
		this.input = new MacOSInputController(
			options.defaultTargetPid,
			this.overlay,
			undefined,
			createDisplaySleepAssertion(),
		);
		this.displayId = options.display;
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
		const size = options?.targetSize ?? (await this.getScreenSize());
		if (options?.region !== undefined) {
			if (windowId !== undefined) {
				throw new Error("region capture cannot be combined with a window target; capture the window instead");
			}
			const region = captureDisplayRegionPng(
				this.displayId ?? getMainDisplayId(),
				options.region,
				size.width,
				size.height,
			);
			return {
				data: region.data,
				mimeType: sniffImageMimeType(region.data),
				width: region.width,
				height: region.height,
			};
		}
		const data = await captureMacOSScreenshot(
			size,
			windowId,
			options?.format ?? "png",
			options?.quality ?? 72,
			this.displayId,
		);
		const dimensions = parseImageDimensions(data);
		return {
			data,
			mimeType: sniffImageMimeType(data),
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
		try {
			return await this.captureAppState(targetPid, options);
		} catch (error) {
			if (targetPid === undefined) {
				for (const pid of this.inputObservations.keys()) {
					this.invalidateInputObservation(pid);
				}
			} else {
				this.invalidateInputObservation(targetPid);
			}
			throw error;
		}
	}

	/**
	 * Pick the window an observation is scoped to: an explicitly requested window, otherwise
	 * the app's focused window, otherwise whatever window enumeration reports. The chosen id
	 * travels back on the state so input can be checked against the same window instead of a
	 * fresh guess.
	 */
	private async describeWindowsForPid(pid: number): Promise<readonly WindowInventoryEntry[]> {
		try {
			const windows = await openWindowsForTargeting();
			return visibleWindowsForPid(windows, pid).map((window) => ({
				id: window.id,
				title: window.title ?? "",
				bounds: {
					x: Math.round(window.bounds.x),
					y: Math.round(window.bounds.y),
					width: Math.round(window.bounds.width),
					height: Math.round(window.bounds.height),
				},
			}));
		} catch {
			return [];
		}
	}

	private async resolveObservationWindow(
		pid: number,
		requestedWindowId?: number,
	): Promise<SkyLightTargetWindow | undefined> {
		if (requestedWindowId !== undefined) {
			return await this.input.rememberTargetWindow(pid, requestedWindowId);
		}
		const focusedWindowId = focusedWindowIdForPid(pid);
		if (focusedWindowId !== undefined) {
			const focusedWindow = await this.input.rememberTargetWindow(pid, focusedWindowId);
			if (focusedWindow !== undefined) {
				return focusedWindow;
			}
		}
		return await this.input.rememberTargetWindow(pid);
	}

	private async captureAppState(targetPid?: number, options?: AppStateOptions): Promise<AppState> {
		const settleMs = options?.settleMs ?? DEFAULT_APP_STATE_SETTLE_MILLISECONDS;
		const apps = await getRunningMacOSApps();
		const app = resolveTargetApp(apps, targetPid);
		this.assertAppApproved(app);
		await this.assertBrowserUrlAllowed(app, options?.requireWindow === true);
		const targetWindow = await this.resolveObservationWindow(app.pid, options?.windowId);
		if (options?.requireWindow === true && targetWindow === undefined) {
			throw new Error(`No visible target window available for pid ${app.pid}`);
		}
		const windowInventory = await this.describeWindowsForPid(app.pid);
		const targetWindowTitle = windowInventory.find((entry) => entry.id === targetWindow?.id)?.title;
		const windowCandidates = windowInventory.length > 1 ? windowInventory : undefined;
		this.observedAxPids.add(app.pid);
		const walkOptions = {
			...(options?.maxElements === undefined ? {} : { maxElements: options.maxElements }),
			...(options?.includeMenuBar === undefined ? {} : { includeMenuBar: options.includeMenuBar }),
			...(targetWindow === undefined ? {} : { windowId: targetWindow.id }),
			...(options?.subtreeOf === undefined ? {} : { subtreeOf: options.subtreeOf }),
		};
		if (settleMs > 0) {
			await this.waitForUiSettle(app.pid, settleMs, walkOptions);
		}
		// Scope the screenshot to the target window at its own aspect ratio (capped),
		// so the model sees an undistorted window image and coordinates invert cleanly.
		// Without a target window, fall back to the full display.
		const size =
			options?.screenshotSize ??
			(targetWindow !== undefined ? resolveWindowScreenshotSize(targetWindow.bounds) : await this.getScreenSize());
		const screenshot =
			options?.includeScreenshot === false
				? { data: Buffer.alloc(0), mimeType: "image/png" as const, width: size.width, height: size.height }
				: await this.captureScreenshot({ targetSize: size, format: "jpeg" }, targetWindow?.id);
		const tree = extractAccessibilityTree(app.pid, walkOptions);
		const display = resolveDisplayInfo();
		const appInstructions = resolveAppInstructions(app.name, app.bundleId);

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
			if (!this.highlightedApps.has(app.pid)) {
				this.highlightedApps.add(app.pid);
				this.overlay.highlight(viewport.windowBounds);
			}
		} else {
			this.lastViewportByPid.delete(app.pid);
		}
		elements = normalizeAxTree(elements);
		const previousTree = this.lastAxTreeByPid.get(app.pid);
		const comparable = previousTree !== undefined && previousTree.walkKey === tree.walkKey;
		const axChangeSummary = comparable ? diffAxTreesByKey(previousTree.elements, elements) : undefined;
		const axChanges = comparable ? diffAxTreeChanges(previousTree.elements, elements) : undefined;
		this.lastAxTreeByPid.set(app.pid, { elements, truncated: tree.truncated, walkKey: tree.walkKey });
		const contentKind = classifyContentKind(elements, { width: screenshot.width, height: screenshot.height });
		const diffOnly = options?.diffOnly === true && previousTree !== undefined;

		const state: AppState = {
			app: app.name,
			bundleId: app.bundleId,
			pid: app.pid,
			frontmost: app.isActive,
			axAvailable: tree.axAvailable,
			elements: diffOnly ? [] : elements,
			...(tree.truncated ? { elementsTruncated: true } : {}),
			screenshotBase64: screenshot.data.toString("base64"),
			screenshotWidth: screenshot.width,
			screenshotHeight: screenshot.height,
			screenshotMimeType: screenshot.mimeType,
			display,
			contentKind,
			...(axChangeSummary !== undefined ? { axChangeSummary } : {}),
			...(axChanges !== undefined ? { axChanges } : {}),
			...(diffOnly ? { treeOmitted: true } : {}),
			...(appInstructions !== undefined ? { appInstructions } : {}),
			...(windowBounds !== undefined ? { windowBounds } : {}),
			...(targetWindow !== undefined ? { windowId: targetWindow.id } : {}),
			...(targetWindowTitle !== undefined ? { windowTitle: targetWindowTitle } : {}),
			...(windowCandidates !== undefined ? { windowCandidates } : {}),
		};
		if (targetWindow === undefined) {
			this.inputObservations.delete(app.pid);
		} else {
			this.observationGeneration += 1;
			this.inputObservations.set(app.pid, {
				generation: this.observationGeneration,
				pid: app.pid,
				bundleId: app.bundleId,
				windowId: targetWindow.id,
				windowBounds: { ...targetWindow.bounds },
				screenshotViewport: {
					width: screenshot.width,
					height: screenshot.height,
					bounds: { ...targetWindow.bounds },
				},
				observedElementIds: new Set(elements.map((element) => element.id)),
			});
		}
		return state;
	}

	private async assertBrowserUrlAllowed(app: RunningAppInfo, requireUrl: boolean): Promise<void> {
		if (this.urlBlocklist.length === 0 || !isBrowserBundle(app.bundleId)) {
			return;
		}
		const url = await readCurrentBrowserUrl(app.bundleId);
		if (url === undefined) {
			if (requireUrl) {
				throw new Error("Computer Use cannot verify the current browser URL.");
			}
			return;
		}
		if (blockedUrl(url, this.urlBlocklist)) {
			throw new Error(`Computer Use is not allowed on the current browser URL: ${url}`);
		}
	}

	private assertAppApproved(app: RunningAppInfo): void {
		if (this.appApproval === undefined) {
			return;
		}
		const decision = this.appApproval.decide(app.bundleId);
		if (decision === "denied") {
			throw new Error(`Computer Use is not allowed to use the app '${app.name}'.`);
		}
		if (decision === "needs-approval") {
			throw new Error(`Computer Use needs your approval to use '${app.name}'. Approve the app and try again.`);
		}
	}

	/**
	 * Wait for the target app's UI to stop changing before capturing state, instead of
	 * sleeping a fixed duration. Polls the accessibility tree and returns as soon as two
	 * consecutive snapshots are identical (the UI has settled) or the `settleMs` cap
	 * elapses, whichever comes first. This is the ChatGPT computer-use "skyshot settle"
	 * technique: faster when the UI is already stable, more robust when it is still moving.
	 */
	private async waitForUiSettle(pid: number, settleMs: number, walkOptions: AccessibilityTreeOptions): Promise<void> {
		// Stability only needs the shape of the visible tree, so each poll walks a capped
		// slice instead of the whole window; the observation that follows is a full walk.
		const signatureOptions: AccessibilityTreeOptions = {
			...walkOptions,
			maxElements: SETTLE_SIGNATURE_MAX_ELEMENTS,
			signatureOnly: true,
		};
		const deadline = Date.now() + settleMs;
		let previous = normalizeAxTree(extractAccessibilityTree(pid, signatureOptions).elements);
		// Poll until the tree is stable across two consecutive reads, or the cap elapses.
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, UI_SETTLE_POLL_MILLISECONDS));
			const current = normalizeAxTree(extractAccessibilityTree(pid, signatureOptions).elements);
			const change = diffAxTreesByKey(previous, current);
			if (change.added === 0 && change.removed === 0 && change.changed === 0) {
				return;
			}
			previous = current;
		}
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
		const running = await getRunningMacOSApps();
		const usage = await collectAppUsage(running.map((app) => app.path).filter((path) => path.length > 0));
		return running.map((app) => {
			const appUsage = usage.get(app.path) ?? {};
			return {
				bundleId: app.bundleId,
				name: app.name,
				pid: app.pid,
				isRunning: true,
				isFrontmost: app.isActive,
				...(appUsage.lastUsedDate !== undefined ? { lastUsedDate: appUsage.lastUsedDate } : {}),
				...(appUsage.useCount !== undefined ? { useCount: appUsage.useCount } : {}),
			};
		});
	}

	async setValue(targetPid: number, elementIndex: number, value: string): Promise<void> {
		setValueByIndex(targetPid, elementIndex, value);
	}

	async selectText(targetPid: number, elementIndex: number, options: SelectTextOptions): Promise<void> {
		selectTextByIndex(targetPid, elementIndex, options);
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

	getInputObservation(targetPid: number): InputObservation | undefined {
		return this.inputObservations.get(targetPid);
	}

	private invalidateInputObservation(targetPid: number): void {
		this.inputObservations.delete(targetPid);
		releaseAccessibilitySnapshot(targetPid);
	}

	async preflightInput(expected: InputObservation): Promise<PreflightResult> {
		const stored = this.inputObservations.get(expected.pid);
		if (stored === undefined || !sameObservation(stored, expected)) {
			return { ok: false, reason: "observation-replaced" };
		}

		let apps: readonly RunningAppInfo[];
		try {
			apps = await getRunningMacOSApps();
		} catch (error) {
			if (error instanceof Error) {
				return { ok: false, reason: "app-not-frontmost" };
			}
			throw error;
		}
		const app = apps.find((candidate) => candidate.pid === expected.pid);
		if (app === undefined || !app.isActive) {
			return { ok: false, reason: "app-not-frontmost" };
		}
		if (app.bundleId !== expected.bundleId) {
			return { ok: false, reason: "observation-replaced" };
		}
		if (this.appApproval?.decide(app.bundleId) !== "approved") {
			return { ok: false, reason: "app-not-approved" };
		}

		if (this.urlBlocklist.length > 0 && isBrowserBundle(app.bundleId)) {
			const url = await readCurrentBrowserUrl(app.bundleId);
			if (url === undefined) {
				return { ok: false, reason: "url-unavailable" };
			}
			if (blockedUrl(url, this.urlBlocklist)) {
				return { ok: false, reason: "url-blocked" };
			}
		}

		let targetWindow: Awaited<ReturnType<typeof queryVisibleTargetWindow>>;
		try {
			targetWindow = await queryVisibleTargetWindow(expected.pid, expected.windowId);
		} catch (error) {
			if (error instanceof Error) {
				return { ok: false, reason: "window-missing" };
			}
			throw error;
		}
		const current = this.inputObservations.get(expected.pid);
		if (current === undefined || !sameObservation(current, expected)) {
			return { ok: false, reason: "observation-replaced" };
		}
		if (this.appApproval?.decide(app.bundleId) !== "approved") {
			return { ok: false, reason: "app-not-approved" };
		}
		if (targetWindow === undefined) {
			const otherWindows = await queryVisibleWindowsForPid(expected.pid);
			return { ok: false, reason: otherWindows.length > 0 ? "window-changed" : "window-missing" };
		}
		if (targetWindow.id !== expected.windowId) {
			return { ok: false, reason: "window-changed" };
		}
		if (!sameRect(targetWindow.bounds, expected.windowBounds)) {
			return { ok: false, reason: "window-bounds-changed" };
		}
		return { ok: true };
	}

	async close(): Promise<void> {
		try {
			this.input.close();
		} finally {
			this.inputObservations.clear();
			for (const pid of this.observedAxPids) {
				releaseAccessibilitySnapshot(pid);
			}
			this.observedAxPids.clear();
		}
	}
}

async function queryVisibleTargetWindow(pid: number, windowId?: number) {
	const windows = await openWindowsForTargeting();
	if (windowId !== undefined) {
		return selectVisibleTargetWindow(windows, pid, undefined, windowId);
	}
	return selectVisibleTargetWindow(windows, pid) ?? (await selectSystemEventsTargetWindow(windows, pid));
}

async function queryVisibleWindowsForPid(pid: number) {
	try {
		return visibleWindowsForPid(await openWindowsForTargeting(), pid);
	} catch {
		return [];
	}
}

async function readCurrentBrowserUrl(bundleId: string): Promise<string | undefined> {
	const script = browserUrlScript(bundleId);
	if (script === undefined) {
		return undefined;
	}
	try {
		const result = await execFileAsync("osascript", ["-e", script], {
			encoding: "utf8",
			timeout: FINDER_DESKTOP_BOUNDS_TIMEOUT_MILLISECONDS,
		});
		const url = execFileStdout(result).trim();
		return url.length === 0 ? undefined : url;
	} catch (error) {
		if (error instanceof Error) {
			return undefined;
		}
		throw error;
	}
}

function sameObservation(left: InputObservation, right: InputObservation): boolean {
	return (
		left.generation === right.generation &&
		left.pid === right.pid &&
		left.bundleId === right.bundleId &&
		left.windowId === right.windowId &&
		sameRect(left.windowBounds, right.windowBounds) &&
		left.screenshotViewport.width === right.screenshotViewport.width &&
		left.screenshotViewport.height === right.screenshotViewport.height &&
		sameRect(left.screenshotViewport.bounds, right.screenshotViewport.bounds) &&
		sameNumberSet(left.observedElementIds, right.observedElementIds)
	);
}

function sameRect(left: Rect, right: Rect): boolean {
	return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function sameNumberSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
	if (left.size !== right.size) {
		return false;
	}
	for (const value of left) {
		if (!right.has(value)) {
			return false;
		}
	}
	return true;
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
	format: "png" | "jpeg" = "png",
	quality = 72,
	displayId?: number,
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
		const captured = captureDisplayPng(displayId ?? getMainDisplayId(), targetSize.width, targetSize.height);
		parsePngDimensions(captured.data);
		return captured.data;
	}

	return await captureWindowScreenshot(targetSize, windowId, format, quality);
}

/**
 * Prefer in-process ScreenCaptureKit for a single window: it captures the window's own
 * pixels even when occluded, and avoids the two subprocesses (screencapture + sips) plus
 * their temporary files. The shell path stays as the fallback whenever the native path is
 * unavailable (no dylib, missing permission, window not capturable, capture timeout).
 */
async function captureWindowScreenshot(
	targetSize: { readonly width: number; readonly height: number },
	windowId: number,
	format: "png" | "jpeg",
	quality: number,
): Promise<Buffer> {
	try {
		const captured = captureWindowImage(windowId, targetSize.width, targetSize.height, format, quality);
		if (captured.data.byteLength > 0) {
			parseImageDimensions(captured.data);
			return captured.data;
		}
	} catch {
		// Fall through to the shell capture below.
	}
	return await captureWindowScreenshotViaCli(targetSize, windowId, format, quality);
}

async function captureWindowScreenshotViaCli(
	targetSize: { readonly width: number; readonly height: number },
	windowId: number,
	format: "png" | "jpeg",
	quality: number,
): Promise<Buffer> {
	const captureCommand = `screencapture -x -o -l ${windowId} -t png "$tmp"`;
	const resizeCommand =
		format === "jpeg"
			? 'sips -s format jpeg -s formatOptions "$4" -z "$2" "$1" "$tmp" --out "$out" >/dev/null'
			: 'sips -z "$2" "$1" "$tmp" --out "$out" >/dev/null';
	const script = [
		"set -eu",
		'tmp=$(mktemp "${TMPDIR:-/tmp}/macos-cua-shot.XXXXXX")',
		'out=""',
		'cleanup() { rm -f "$tmp"; if [ -n "$out" ]; then rm -f "$out"; fi; }',
		"trap cleanup EXIT",
		captureCommand,
		'out=$(mktemp "${TMPDIR:-/tmp}/macos-cua-shot-resized.XXXXXX")',
		resizeCommand,
		'cat "$out"',
	].join("\n");
	const result = await execFileAsync(
		"sh",
		[
			"-c",
			script,
			"macos-cua-screenshot",
			String(targetSize.width),
			String(targetSize.height),
			format,
			String(Math.max(1, Math.min(100, Math.round(quality)))),
		],
		{
			encoding: "buffer",
			maxBuffer: SCREENSHOT_MAX_BUFFER_BYTES,
			timeout: SCREENSHOT_TIMEOUT_MILLISECONDS,
		},
	);
	const data = execFileStdoutBuffer(result);
	parseImageDimensions(data);
	return data;
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

function remapElementFramesToScreenshot(
	elements: readonly AXTreeElement[],
	viewport: ScreenshotViewport,
): AXTreeElement[] {
	return elements.map((element) => ({
		...element,
		frame: screenRectToScreenshot(element.frame, viewport),
	}));
}

function resolveDisplayInfo(): DisplayInfo {
	const logical = getMainDisplayLogicalSize();
	let nativePixel: { width: number; height: number } | undefined;
	try {
		nativePixel = getMainDisplayNativePixelSize();
	} catch {
		nativePixel = undefined;
	}
	return resolveDisplayMetadata(nativePixel === undefined ? { logical } : { logical, nativePixel });
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
