import { setTimeout as sleep } from "node:timers/promises";
import { resolveWindowScreenshotSize } from "../computer/viewport.js";
import type { Point } from "../types/index.js";
import {
	type IOSInputTarget,
	type SwipeKind,
	longPressMirroring,
	pressMirroringCombo,
	scrollMirroring,
	swipeMirroring,
	tapMirroring,
	typeIntoMirroring,
} from "./ios-input.js";
import {
	type AXElementFrame,
	type AXUIElementRef,
	K_AX_CHILDREN_ATTRIBUTE,
	K_AX_DESCRIPTION_ATTRIBUTE,
	K_AX_ROLE_ATTRIBUTE,
	K_AX_TITLE_ATTRIBUTE,
	K_AX_VALUE_ATTRIBUTE,
	copyAttributeValue,
	copyOptionalAttributeValue,
	createApplicationElement,
	elementFrame,
	performAction,
	releaseAXElement,
} from "./macos-ffi/accessibility.js";
import {
	type CFTypeRef,
	cfArrayLength,
	cfArrayValueAt,
	cfRelease,
	fromCFBoolean,
	fromCFString,
	isCFArray,
	isCFBoolean,
	isCFString,
} from "./macos-ffi/corefoundation.js";
import { captureWindowPng } from "./macos-ffi/screenshot.js";
import { type OcrTextObservation, readImagePixelSize, recognizeTextInImage } from "./macos-ffi/vision.js";
import { listWindows } from "./macos-ffi/window-list.js";
import type { ListedWindow } from "./macos-ffi/window-list.js";
import { activateApplication, findRunningApplication, getRunningApplications } from "./macos-ffi/workspace.js";
import { type TopLevelWindow, listTopLevelWindows } from "./macos-top-level-windows.js";

/** iPhone Mirroring: the phone is a window, so everything here is scoped to that window. */
export const IPHONE_MIRRORING_BUNDLE_ID = "com.apple.ScreenContinuity";
export const IPHONE_MIRRORING_APP_NAME = "iPhone Mirroring";

/**
 * ready        the phone is connected and the image is live
 * blocked      an interstitial is up (iPhone in Use, paused, ended, locked, connect, Mac login)
 * no-window    the app runs but owns no phone window
 * not-running  the app is not running at all
 */
export type MirroringSessionState = "ready" | "blocked" | "no-window" | "not-running";

export interface MirroringWindow {
	readonly id: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Recognised text from the phone screen, positioned in global screen points. */
export interface MirroringText {
	readonly text: string;
	readonly confidence: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface MirroringAxEntry {
	readonly role: string;
	readonly text: string;
}

export interface MirroringObservation {
	readonly state: MirroringSessionState;
	readonly window: MirroringWindow;
	readonly imageWidth: number;
	readonly imageHeight: number;
	readonly texts: readonly MirroringText[];
}

export interface MirroringFocusProbe {
	/** Does the app hold keyboard focus, read live from AX rather than from a workspace notification. */
	readonly appFrontmost: boolean | null;
	/** Index of the app's window in the front-to-back on-screen list; null means nothing of it is on screen. */
	readonly depth: number | null;
}

/** Roles that carry user-visible text. A live phone image has none of them; every interstitial does. */
const AX_TEXT_ROLES: ReadonlySet<string> = new Set([
	"AXStaticText",
	"AXButton",
	"AXTextField",
	"AXSecureTextField",
	"AXImage",
]);

const AX_MAX_DEPTH = 6;
const AX_MAX_ENTRIES = 40;
const AX_FRAME_TOLERANCE = 4;

/**
 * Interstitials macOS draws in the mirroring window. Structural detection (any AX content at
 * all) is the primary signal and works in any language; this list is the fallback for a build
 * where accessibility cannot see into the window, and it can never be complete — it missed
 * "Connection Paused" and the Mac login prompt in English alone.
 */
const BLOCKED_MARKERS: readonly string[] = [
	"iphone in use",
	"lock your iphone",
	"mirroring ended",
	"to connect",
	"connection paused",
	"connection interrupted",
	"is locked",
	"enter the mac login",
	"try again",
];

const ACTIVATE_POLL_MILLISECONDS = 80;
const ACTIVATE_TIMEOUT_MILLISECONDS = 2500;
const OCCLUSION_RECHECK_MILLISECONDS = 150;

/**
 * The mirroring window among an app's windows.
 *
 * Matched by owner pid, never by window title or owner name: those are localized ("iPhone镜像" on
 * a Chinese system), so an English comparison finds nothing and reports a connected phone as
 * disconnected. There is deliberately no size filter — with Stage Manager an inactive window is
 * parked in the rail at roughly 38x130, which is on-screen and genuinely the phone; a size guard
 * turned every app that took the stage into a false "phone disconnected". Window list order is
 * front to back, so the first candidate is the frontmost.
 */
export function selectMirroringWindow(windows: readonly TopLevelWindow[], pid: number): TopLevelWindow | undefined {
	return windows.find((window) => window.ownerPid === pid && window.bounds.width > 0 && window.bounds.height > 0);
}

export interface MirroringWindowChoice {
	readonly window: TopLevelWindow;
	/** True when the window is not on the Space in front of the user right now. */
	readonly offCurrentSpace: boolean;
}

/**
 * Which of the app's windows is the phone, preferring the one the user can see.
 *
 * A phone window on another Space still exists, and the synthesized records this driver posts are
 * addressed to the window itself, so it can still be driven. Reporting it as a disconnected phone
 * sends the user hunting for a connection problem that is not there — measured the hard way when
 * the terminal and the phone window sat on different Spaces.
 */
export function chooseMirroringWindow(
	onCurrentSpace: readonly TopLevelWindow[],
	anywhere: readonly TopLevelWindow[],
	pid: number,
): MirroringWindowChoice | undefined {
	const visible = selectMirroringWindow(onCurrentSpace, pid);
	if (visible !== undefined) {
		return { window: visible, offCurrentSpace: false };
	}
	const parked = selectMirroringWindow(anywhere, pid);
	return parked === undefined ? undefined : { window: parked, offCurrentSpace: true };
}

/**
 * Does the phone window own this point — is it the topmost normal window there?
 *
 * A scroll is delivered to whatever window sits under the pointer, so this is the difference
 * between scrolling the phone and scrolling whatever the user just brought forward.
 */
export function windowOwnsPoint(
	windows: readonly Pick<TopLevelWindow, "ownerPid" | "bounds">[],
	pid: number,
	x: number,
	y: number,
): boolean {
	for (const window of windows) {
		const { bounds } = window;
		if (x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) {
			continue;
		}
		return window.ownerPid === pid;
	}
	return false;
}

/**
 * Classify the session from what the machine reports.
 *
 * A working session exposes no accessibility content inside the window: the phone image is a
 * video stream, opaque to AX. Every interstitial is an ordinary Mac view with labels and a
 * button. That asymmetry is the signal — it holds in any language and for screens Apple has not
 * shipped yet, where matching known phrases does neither.
 */
export function classifyMirroringSession(input: {
	readonly running: boolean;
	readonly hasWindow: boolean;
	readonly axContent: readonly MirroringAxEntry[];
	readonly screenTexts: readonly string[];
}): MirroringSessionState {
	if (!input.running) {
		return "not-running";
	}
	if (!input.hasWindow) {
		return "no-window";
	}
	if (input.axContent.length > 0) {
		return "blocked";
	}
	const haystack = input.screenTexts.join(" ").toLowerCase();
	return BLOCKED_MARKERS.some((marker) => haystack.includes(marker)) ? "blocked" : "ready";
}

/**
 * Recognised boxes (image pixels, top-left origin) into global screen points.
 *
 * A window capture is not necessarily the size of the window: on a Retina display it comes back
 * at the backing scale. Scaling by the ratio between the window's own size and the capture's
 * pixel size is what makes the same code work for both.
 */
export function ocrTextsToScreenPoints(
	observations: readonly OcrTextObservation[],
	window: MirroringWindow,
	imageWidth: number,
	imageHeight: number,
): readonly MirroringText[] {
	if (imageWidth <= 0 || imageHeight <= 0) {
		throw new Error(`a capture of ${window.id} reported an unusable size: ${imageWidth}x${imageHeight}`);
	}
	const scaleX = window.width / imageWidth;
	const scaleY = window.height / imageHeight;
	return observations.map((observation) => ({
		text: observation.text,
		confidence: observation.confidence,
		x: window.x + observation.box.x * scaleX,
		y: window.y + observation.box.y * scaleY,
		width: observation.box.width * scaleX,
		height: observation.box.height * scaleY,
	}));
}

/** What the user has to do about a session that is not ready. Never a tap-through instruction. */
export function describeMirroringState(state: MirroringSessionState, detail?: string): string {
	switch (state) {
		case "ready":
			return `${IPHONE_MIRRORING_APP_NAME} is connected and ready.`;
		case "not-running":
			return `${IPHONE_MIRRORING_APP_NAME} isn't running — open the ${IPHONE_MIRRORING_APP_NAME} app and connect your phone, then retry. Reconnecting is physical, so I can't do it for you.`;
		case "no-window":
			return `${IPHONE_MIRRORING_APP_NAME} is open but no phone is connected. Connect your phone in the app, then retry.`;
		case "blocked":
			return [
				`${IPHONE_MIRRORING_APP_NAME} is not connected — an interstitial is on screen.`,
				detail === undefined ? "" : `It says: ${detail}`,
				'This needs you: clear it on the Mac, and if it says "iPhone in Use", lock your iPhone so mirroring can resume. Then retry — I will not tap Connect for you.',
			]
				.filter((part) => part.length > 0)
				.join(" ");
	}
}

export function mirroringProcess(): { readonly pid: number; readonly name: string } | undefined {
	const application = findRunningApplication(IPHONE_MIRRORING_BUNDLE_ID);
	return application === undefined ? undefined : { pid: application.pid, name: application.name };
}

export function toMirroringWindow(window: TopLevelWindow): MirroringWindow {
	return {
		id: window.id,
		x: window.bounds.x,
		y: window.bounds.y,
		width: window.bounds.width,
		height: window.bounds.height,
	};
}

/** The phone window, on this Space when it is here and on another one when it is not. */
export async function findMirroringWindow(): Promise<MirroringWindow | undefined> {
	const process = mirroringProcess();
	if (process === undefined) {
		return undefined;
	}
	const choice = chooseMirroringWindow(
		toTopLevelWindows(listWindows({ onScreenOnly: true })),
		toTopLevelWindows(listWindows({ onScreenOnly: false })),
		process.pid,
	);
	return choice === undefined ? undefined : toMirroringWindow(choice.window);
}

function toTopLevelWindows(listed: readonly ListedWindow[] | undefined): readonly TopLevelWindow[] {
	if (listed === undefined) {
		return [];
	}
	return listed.map((window) => ({
		id: window.id,
		ownerPid: window.ownerPid,
		ownerName: window.ownerName,
		title: window.title,
		bounds: window.bounds,
	}));
}

/**
 * Accessibility content drawn inside the mirroring window, as [(role, text)].
 *
 * A connected session returns an empty list. The interstitials macOS draws in that window are
 * ordinary Mac views, so they come back with their labels — which is how the session is judged
 * without reading any language-specific phrase.
 */
export function mirroringWindowAxContent(pid: number, window: MirroringWindow): readonly MirroringAxEntry[] {
	let root: CFTypeRef | null = null;
	try {
		root = createApplicationElement(pid);
		const windowsValue = copyAttributeValue(root, "AXWindows");
		if (windowsValue === null) {
			return [];
		}
		try {
			if (!isCFArray(windowsValue)) {
				return [];
			}
			const count = cfArrayLength(windowsValue);
			for (let index = 0; index < count; index += 1) {
				const candidate = cfArrayValueAt(windowsValue, index);
				if (candidate === null) {
					continue;
				}
				// Matched by geometry: the app also owns a settings sheet and a welcome dialog, and
				// counting their contents would report a healthy session as blocked.
				const frame = elementFrame(candidate as AXUIElementRef);
				if (frame === undefined || !framesMatch(frame, window)) {
					continue;
				}
				return walkAxText(candidate as AXUIElementRef, 0, []);
			}
			return [];
		} finally {
			cfRelease(windowsValue);
		}
	} catch {
		// Accessibility permission missing, or the app went away mid-walk: report "nothing seen",
		// which the classifier treats as a live image rather than as a blocked session.
		return [];
	} finally {
		if (root !== null) {
			releaseAXElement(root);
		}
	}
}

function framesMatch(frame: AXElementFrame, window: MirroringWindow): boolean {
	return (
		Math.abs(frame.x - window.x) < AX_FRAME_TOLERANCE &&
		Math.abs(frame.y - window.y) < AX_FRAME_TOLERANCE &&
		Math.abs(frame.width - window.width) < AX_FRAME_TOLERANCE &&
		Math.abs(frame.height - window.height) < AX_FRAME_TOLERANCE
	);
}

function walkAxText(element: AXUIElementRef, depth: number, out: MirroringAxEntry[]): readonly MirroringAxEntry[] {
	if (depth > AX_MAX_DEPTH || out.length >= AX_MAX_ENTRIES) {
		return out;
	}
	const role = stringAttribute(element, K_AX_ROLE_ATTRIBUTE);
	if (role !== undefined && AX_TEXT_ROLES.has(role)) {
		const parts: string[] = [];
		for (const attribute of [K_AX_TITLE_ATTRIBUTE, K_AX_VALUE_ATTRIBUTE, K_AX_DESCRIPTION_ATTRIBUTE]) {
			const value = stringAttribute(element, attribute);
			if (value !== undefined && value.trim().length > 0) {
				parts.push(value.trim());
			}
		}
		out.push({ role, text: parts.join(" ") });
	}
	const children = copyOptionalAttributeValue(element, K_AX_CHILDREN_ATTRIBUTE);
	if (children === null) {
		return out;
	}
	try {
		if (!isCFArray(children)) {
			return out;
		}
		const count = cfArrayLength(children);
		for (let index = 0; index < count; index += 1) {
			const child = cfArrayValueAt(children, index);
			if (child !== null) {
				walkAxText(child as AXUIElementRef, depth + 1, out);
			}
		}
	} finally {
		cfRelease(children);
	}
	return out;
}

function stringAttribute(element: AXUIElementRef, attribute: string): string | undefined {
	const value = copyOptionalAttributeValue(element, attribute);
	if (value === null) {
		return undefined;
	}
	try {
		return isCFString(value) ? fromCFString(value) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Where the phone session stands right now, including the interstitial check.
 *
 * Costs a capture when accessibility reports nothing inside the window, because a phone image is
 * opaque and the marker list is the only remaining signal. That is the same trade the reference
 * harness makes, and it is why this is not on a hot path.
 */
export async function mirroringSessionStatus(
	options: { readonly checkMarkers?: boolean } = {},
): Promise<{ readonly state: MirroringSessionState; readonly detail: string; readonly window?: MirroringWindow }> {
	const process = mirroringProcess();
	const window = process === undefined ? undefined : await findMirroringWindow();
	const axContent = process === undefined || window === undefined ? [] : mirroringWindowAxContent(process.pid, window);
	const detail = axContent
		.filter((entry) => entry.role === "AXStaticText" && entry.text.length > 0)
		.map((entry) => entry.text)
		.join(" ");
	let screenTexts: readonly string[] = [];
	if (process !== undefined && window !== undefined && axContent.length === 0 && (options.checkMarkers ?? true)) {
		try {
			screenTexts = recognizeTextInImage(captureMirroringWindow(window)).map((observation) => observation.text);
		} catch {
			screenTexts = [];
		}
	}
	const state = classifyMirroringSession({
		running: process !== undefined,
		hasWindow: window !== undefined,
		axContent,
		screenTexts,
	});
	return window === undefined ? { state, detail } : { state, detail, window };
}

/** The phone window, or the refusal that tells the user what to do about it. */
export async function requireMirroringWindow(): Promise<MirroringWindow> {
	const process = mirroringProcess();
	if (process === undefined) {
		throw new Error(describeMirroringState("not-running"));
	}
	const window = await findMirroringWindow();
	if (window === undefined) {
		throw new Error(describeMirroringState("no-window"));
	}
	return window;
}

/**
 * The phone window when the session is usable. Never launches the app, never taps Connect, never
 * polls to reconnect: resuming mirroring is physical and only the user can do it.
 */
export async function requireMirroringSession(): Promise<{
	readonly process: { pid: number; name: string };
	readonly window: MirroringWindow;
}> {
	const status = await mirroringSessionStatus();
	if (status.state !== "ready") {
		throw new Error(describeMirroringState(status.state, status.detail));
	}
	const process = mirroringProcess();
	const window = await findMirroringWindow();
	if (process === undefined || window === undefined) {
		throw new Error(describeMirroringState(process === undefined ? "not-running" : "no-window"));
	}
	return { process, window };
}

/**
 * Bring the phone window frontmost and confirm it.
 *
 * Raises rather than returning unfocused: a silent failure here means every subsequent tap is
 * delivered to some other app. Both signals are required — AXFrontmost can read true while
 * another app's window still sits on top, and keyboard and scroll events follow window order,
 * not AX.
 */
export async function activateMirroring(timeoutMs = ACTIVATE_TIMEOUT_MILLISECONDS): Promise<MirroringWindow> {
	const process = mirroringProcess();
	if (process === undefined) {
		throw new Error(describeMirroringState("not-running"));
	}
	const window = await findMirroringWindow();
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		activateApplication(process.pid);
		if (window !== undefined) {
			raiseAxWindow(process.pid, window);
		}
		await sleep(ACTIVATE_POLL_MILLISECONDS);
		if (await isMirroringFrontmost()) {
			return await requireMirroringWindow();
		}
		if (Date.now() >= deadline) {
			break;
		}
	}
	const probe = await probeMirroringFocus();
	const frontmostWindow = (await listTopLevelWindows())[0];
	const owner = frontmostWindow?.ownerName ?? "another application";
	const detail =
		probe?.appFrontmost === true
			? `${IPHONE_MIRRORING_APP_NAME} has focus without being raised; "${owner}" still owns the frontmost window`
			: `"${owner}" still has focus`;
	throw new Error(
		`could not bring ${IPHONE_MIRRORING_APP_NAME} frontmost within ${timeoutMs}ms — ${detail}. Input would be swallowed, so nothing was sent.`,
	);
}

function raiseAxWindow(pid: number, window: MirroringWindow): void {
	const element = axWindowElement(pid, window);
	if (element === null) {
		return;
	}
	try {
		performAction(element, "AXRaise");
	} catch {
		// Raising is best-effort: the activation above is the primary mechanism.
	}
}

function axWindowElement(pid: number, window: MirroringWindow): AXUIElementRef | null {
	let root: CFTypeRef | null = null;
	try {
		root = createApplicationElement(pid);
		const windowsValue = copyAttributeValue(root, "AXWindows");
		if (windowsValue === null) {
			return null;
		}
		try {
			if (!isCFArray(windowsValue)) {
				return null;
			}
			const count = cfArrayLength(windowsValue);
			for (let index = 0; index < count; index += 1) {
				const candidate = cfArrayValueAt(windowsValue, index);
				if (candidate === null) {
					continue;
				}
				const frame = elementFrame(candidate as AXUIElementRef);
				if (frame !== undefined && framesMatch(frame, window)) {
					return candidate as AXUIElementRef;
				}
			}
			return null;
		} finally {
			cfRelease(windowsValue);
		}
	} catch {
		return null;
	} finally {
		if (root !== null) {
			releaseAXElement(root);
		}
	}
}

/** Both signals the interruption probe compares: AX focus, and depth in the window order. */
export async function probeMirroringFocus(): Promise<MirroringFocusProbe | undefined> {
	const process = mirroringProcess();
	if (process === undefined) {
		return undefined;
	}
	const windows = await listTopLevelWindows();
	const depth = windows.findIndex((window) => window.ownerPid === process.pid);
	return {
		appFrontmost: readAppFrontmost(process.pid),
		depth: depth === -1 ? null : depth,
	};
}

/**
 * What a user would actually notice between two probes. Taking keyboard focus is a mild
 * annoyance; covering the screen is not, and the two are reported separately.
 */
export function describeInterruption(
	before: MirroringFocusProbe,
	after: MirroringFocusProbe,
): { readonly raised: boolean; readonly stoleFocus: boolean } {
	const raised = after.depth !== null && (before.depth === null || after.depth < before.depth);
	return { raised, stoleFocus: after.appFrontmost === true && before.appFrontmost !== true };
}

export async function isMirroringFrontmost(): Promise<boolean> {
	const process = mirroringProcess();
	if (process === undefined) {
		return false;
	}
	if (readAppFrontmost(process.pid) !== true) {
		return false;
	}
	const frontmost = (await listTopLevelWindows())[0];
	return frontmost?.ownerPid === process.pid;
}

function readAppFrontmost(pid: number): boolean | null {
	let root: CFTypeRef | null = null;
	try {
		root = createApplicationElement(pid);
		const value = copyOptionalAttributeValue(root, "AXFrontmost");
		if (value === null || !isCFBoolean(value)) {
			return null;
		}
		return fromCFBoolean(value);
	} catch {
		return null;
	} finally {
		if (root !== null) {
			releaseAXElement(root);
		}
	}
}

/**
 * Capture the phone window as PNG.
 *
 * Asked for at twice the window's point size, because a Retina capture is what Vision reads
 * best; the returned image may be smaller (a non-Retina window) or larger, which is why every
 * caller derives the scale from the decoded size instead of assuming one.
 */
export function captureMirroringWindow(window: MirroringWindow): Buffer {
	const requested = resolveWindowScreenshotSize({ width: window.width * 2, height: window.height * 2 });
	return captureWindowPng(window.id, requested.width, requested.height).data;
}

/** One look at the phone: session state, window, and every visible string with a tap-ready point. */
export async function observeMirroring(
	options: { readonly minimumConfidence?: number } = {},
): Promise<MirroringObservation> {
	const process = mirroringProcess();
	if (process === undefined) {
		throw new Error(describeMirroringState("not-running"));
	}
	const window = await findMirroringWindow();
	if (window === undefined) {
		throw new Error(describeMirroringState("no-window"));
	}
	const axContent = mirroringWindowAxContent(process.pid, window);
	const image = captureMirroringWindow(window);
	const size = readImagePixelSize(image);
	const observations = recognizeTextInImage(
		image,
		options.minimumConfidence === undefined ? {} : { minimumConfidence: options.minimumConfidence },
	);
	const texts = ocrTextsToScreenPoints(observations, window, size.width, size.height);
	const state = classifyMirroringSession({
		running: true,
		hasWindow: true,
		axContent,
		screenTexts: texts.map((text) => text.text),
	});
	return { state, window, imageWidth: size.width, imageHeight: size.height, texts };
}

/**
 * Refuse to fire a gesture at a point another window covers. The phone window is raised first,
 * and if it still does not own the point the gesture is not sent at all: it would land in that
 * other app, silently and possibly destructively.
 */
export async function requireMirroringWindowAt(pid: number, point: Point): Promise<void> {
	if (windowOwnsPoint(await listTopLevelWindows(), pid, point.x, point.y)) {
		return;
	}
	await activateMirroring().catch(() => undefined);
	await sleep(OCCLUSION_RECHECK_MILLISECONDS);
	if (!windowOwnsPoint(await listTopLevelWindows(), pid, point.x, point.y)) {
		throw new Error(
			`another window covers (${Math.round(point.x)}, ${Math.round(point.y)}) — refusing to send the gesture there, because it would land in that app instead of the phone. Move or minimise it, or bring ${IPHONE_MIRRORING_APP_NAME} forward.`,
		);
	}
}

export interface IPhoneMirroringOptions {
	/** "background" (default) drives the phone without taking focus; "attended" focuses it first. */
	readonly delivery?: "background" | "attended";
	readonly minimumConfidence?: number;
}

/**
 * The phone as one object: observe, act, and stay honest about what could not be done.
 *
 * Every action re-proves the session first, so a phone that got locked, disconnected, or covered
 * produces a refusal naming what the user has to do rather than a silent no-op.
 */
export class IPhoneMirroring {
	private readonly delivery: "background" | "attended";
	private readonly minimumConfidence: number | undefined;

	constructor(options: IPhoneMirroringOptions = {}) {
		this.delivery = options.delivery ?? "background";
		this.minimumConfidence = options.minimumConfidence;
	}

	private async target(): Promise<{ readonly target: IOSInputTarget; readonly window: MirroringWindow }> {
		const session = await requireMirroringSession();
		if (this.delivery === "attended") {
			await activateMirroring();
		}
		return {
			target: {
				pid: session.process.pid,
				windowId: session.window.id,
				bounds: {
					x: session.window.x,
					y: session.window.y,
					width: session.window.width,
					height: session.window.height,
				},
				delivery: this.delivery,
			},
			window: session.window,
		};
	}

	async state(): Promise<MirroringSessionState> {
		return (await mirroringSessionStatus()).state;
	}

	async observe(): Promise<MirroringObservation> {
		await requireMirroringSession();
		return await observeMirroring(
			this.minimumConfidence === undefined ? {} : { minimumConfidence: this.minimumConfidence },
		);
	}

	async screenshot(): Promise<Buffer> {
		const window = await requireMirroringWindow();
		return captureMirroringWindow(window);
	}

	/**
	 * Wait for the phone screen to stop changing, then report what is on it. Event-driven in the
	 * sense that matters: a screen that settles costs one extra read, where a fixed sleep would
	 * cost its full budget on every action.
	 */
	async waitForSettle(
		options: { readonly budgetMs?: number; readonly pollMs?: number } = {},
	): Promise<MirroringObservation> {
		const budgetMs = options.budgetMs ?? 2500;
		const pollMs = options.pollMs ?? 250;
		const deadline = Date.now() + budgetMs;
		let previous: readonly MirroringText[] = [];
		let observation = await this.observe();
		while (Date.now() < deadline) {
			await sleep(pollMs);
			previous = observation.texts;
			observation = await this.observe();
			if (textsMatch(previous, observation.texts)) {
				break;
			}
		}
		return observation;
	}

	async tap(x: number, y: number): Promise<void> {
		const { target } = await this.target();
		await tapMirroring(target, { x, y });
	}

	async longPress(x: number, y: number, durationMs?: number): Promise<void> {
		const { target } = await this.target();
		await longPressMirroring(target, { x, y }, durationMs);
	}

	/**
	 * Tap a visible string by its label. On failure the error lists what IS on the screen, so the
	 * next step is informed rather than blind.
	 */
	async tapText(
		query: string,
		options: { readonly index?: number; readonly exact?: boolean } = {},
	): Promise<MirroringText> {
		const observation = await this.observe();
		const matches = findTexts(observation.texts, query, options.exact ?? false);
		const hit = matches[options.index ?? 0];
		if (hit === undefined) {
			const visible = observation.texts.slice(0, 30).map((text) => text.text);
			throw new Error(`no visible text matches ${JSON.stringify(query)}; saw: ${JSON.stringify(visible)}`);
		}
		await this.tap(hit.x + hit.width / 2, hit.y + hit.height / 2);
		return hit;
	}

	/**
	 * Swipe with the finger direction: `swipe("up")` is a thumb moving up. Use it for Home Screen
	 * pages and carousels; on macOS 26 a vertical touch-drag is dropped, so lists move with
	 * {@link scroll} instead.
	 */
	async swipe(
		direction: "up" | "down" | "left" | "right",
		options: { readonly distance?: number; readonly kind?: SwipeKind; readonly at?: Point } = {},
	): Promise<void> {
		const { target, window } = await this.target();
		const fraction = options.distance ?? 0.5;
		const centre = options.at ?? { x: window.x + window.width / 2, y: window.y + window.height / 2 };
		const stepX = direction === "left" ? -1 : direction === "right" ? 1 : 0;
		const stepY = direction === "up" ? -1 : direction === "down" ? 1 : 0;
		const half = {
			x: (stepX * window.width * fraction) / 2,
			y: (stepY * window.height * fraction) / 2,
		};
		await swipeMirroring(target, {
			from: { x: centre.x - half.x, y: centre.y - half.y },
			to: { x: centre.x + half.x, y: centre.y + half.y },
			...(options.kind === undefined ? {} : { kind: options.kind }),
		});
	}

	/**
	 * Scroll the phone's content. `direction` is what you want to SEE — "down" reveals content
	 * further down the list — and `amount` is a fraction of the window.
	 */
	async scroll(
		direction: "up" | "down" | "left" | "right",
		options: { readonly amount?: number; readonly at?: Point } = {},
	): Promise<void> {
		const { target, window } = await this.target();
		const amount = options.amount ?? 0.3;
		const at = options.at ?? { x: window.x + window.width / 2, y: window.y + window.height / 2 };
		const focusBefore = frontmostApplicationPid();
		await requireMirroringWindowAt(target.pid, at);
		try {
			await scrollMirroring(target, {
				at,
				deltaY: direction === "down" ? window.height * amount : direction === "up" ? -window.height * amount : 0,
				deltaX: direction === "right" ? window.width * amount : direction === "left" ? -window.width * amount : 0,
			});
		} finally {
			if (this.delivery === "background" && focusBefore !== undefined) {
				activateApplication(focusBefore);
			}
		}
	}

	async pressKeys(combo: string): Promise<void> {
		const { target } = await this.target();
		await pressMirroringCombo(target, combo);
	}

	/**
	 * Type into the focused field. "paste" (default) is exact; "keystrokes" sends real key events
	 * at the cost of running through iOS autocorrect.
	 */
	async typeText(text: string, options: { readonly mode?: "paste" | "keystrokes" } = {}): Promise<void> {
		const { target } = await this.target();
		await typeIntoMirroring(target, text, options);
	}

	async home(): Promise<void> {
		await this.pressKeys("cmd+1");
	}

	async appSwitcher(): Promise<void> {
		await this.pressKeys("cmd+2");
	}

	async openApp(name: string): Promise<void> {
		await this.pressKeys("cmd+3");
		await sleep(900);
		await this.typeText(name, { mode: "keystrokes" });
		await sleep(1200);
		await this.pressKeys("return");
	}
}

export function findTexts(texts: readonly MirroringText[], query: string, exact: boolean): readonly MirroringText[] {
	const needle = query.toLowerCase();
	return texts.filter((text) =>
		exact ? text.text.toLowerCase() === needle : text.text.toLowerCase().includes(needle),
	);
}

function textsMatch(left: readonly MirroringText[], right: readonly MirroringText[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((text, index) => {
		const other = right[index];
		return other !== undefined && text.text === other.text && text.x === other.x && text.y === other.y;
	});
}

function frontmostApplicationPid(): number | undefined {
	return getRunningApplications().find((application) => application.isActive)?.pid;
}
