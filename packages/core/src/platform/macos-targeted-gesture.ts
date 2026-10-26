import { setTimeout as sleep } from "node:timers/promises";
import type { Point } from "../types/index.js";
import { focusedWindowIdForPid } from "./macos-ffi/accessibility.js";
import { type MouseButton, getCurrentCursorPosition, warpCursorPosition } from "./macos-ffi/coregraphics.js";
import {
	type FocusRestoreToken,
	type SkyLightTargetWindow,
	beginFocusWithoutRaise,
	frontProcessSerialNumber,
	processSerialNumbersMatch,
	restoreFrontProcessNoWindows,
} from "./macos-ffi/skylight.js";

const FOCUS_SETTLE_MILLISECONDS_DEFAULT = 25;
const HOVER_MILLISECONDS_DEFAULT = 15;
const PRIMER_GAP_MILLISECONDS = 1;
const PRIMER_TO_CLICK_MILLISECONDS_DEFAULT = 40;
const CLICK_DRAIN_MILLISECONDS_DEFAULT = 25;
const OFFSCREEN_PRIMER: Point = { x: -1, y: -1 };

function gestureDelayMilliseconds(name: string, defaultValue: number): number {
	const raw = process.env[name]?.trim();
	if (raw === undefined || raw.length === 0) {
		return defaultValue;
	}
	const value = Number(raw);
	return Number.isInteger(value) && value >= 0 ? value : defaultValue;
}

export function gestureFocusSettleMilliseconds(): number {
	return gestureDelayMilliseconds("APPLE_CUA_GESTURE_FOCUS_SETTLE_MS", FOCUS_SETTLE_MILLISECONDS_DEFAULT);
}

export function gestureHoverMilliseconds(): number {
	return gestureDelayMilliseconds("APPLE_CUA_GESTURE_HOVER_MS", HOVER_MILLISECONDS_DEFAULT);
}

export function gesturePrimerToClickMilliseconds(): number {
	return gestureDelayMilliseconds("APPLE_CUA_GESTURE_PRIMER_TO_CLICK_MS", PRIMER_TO_CLICK_MILLISECONDS_DEFAULT);
}

export function gestureClickDrainMilliseconds(): number {
	return gestureDelayMilliseconds("APPLE_CUA_GESTURE_CLICK_DRAIN_MS", CLICK_DRAIN_MILLISECONDS_DEFAULT);
}

export function needsActivationEngagement(input: {
	readonly frontProcessMatchesTarget: boolean;
	readonly focusedWindowMatchesTarget: boolean;
}): boolean {
	return !(input.frontProcessMatchesTarget && input.focusedWindowMatchesTarget);
}

/**
 * Engagement (focus settle plus offscreen primer) is only needed when this gesture makes the target front/key.
 * If the target process is already frontmost and its target window already key, no activation happens and no first
 * click is consumed.
 */
export interface GestureSleepOptions {
	readonly sleep?: (milliseconds: number) => Promise<void>;
	readonly targetPid?: number;
}

export type TargetedMousePost = (
	kind: "move" | "down" | "up" | "drag",
	position: Point,
	button: MouseButton,
	clickState: number | undefined,
	targetWindow: SkyLightTargetWindow,
) => Promise<void>;

export async function runFocusLeasedGesture(
	targetWindow: SkyLightTargetWindow,
	hoverPosition: Point,
	post: TargetedMousePost,
	body: () => Promise<void>,
	options: GestureSleepOptions = {},
): Promise<void> {
	const wait = options.sleep ?? ((milliseconds) => sleep(milliseconds).then(() => undefined));
	const savedCursor = getCurrentCursorPosition();
	const previousFront = options.targetPid === undefined ? null : frontProcessSerialNumber();
	const focusedWindowMatchesTarget =
		options.targetPid !== undefined && focusedWindowIdForPid(options.targetPid) === targetWindow.id;
	const token = beginFocusWithoutRaise(targetWindow);
	if (token === null) {
		throw new Error("failed to activate target window without raising it");
	}
	try {
		const engage =
			options.targetPid === undefined ||
			needsActivationEngagement({
				frontProcessMatchesTarget:
					previousFront !== null && processSerialNumbersMatch(previousFront, token.targetPsn),
				focusedWindowMatchesTarget,
			});
		const focusSettle = gestureFocusSettleMilliseconds();
		if (engage && focusSettle > 0) await wait(focusSettle);
		await post("move", hoverPosition, "left", undefined, targetWindow);
		const hover = gestureHoverMilliseconds();
		if (hover > 0) await wait(hover);
		if (engage) {
			await post("down", OFFSCREEN_PRIMER, "left", 1, targetWindow);
			await wait(PRIMER_GAP_MILLISECONDS);
			await post("up", OFFSCREEN_PRIMER, "left", 1, targetWindow);
			const primerToClick = gesturePrimerToClickMilliseconds();
			if (primerToClick > 0) await wait(primerToClick);
		}
		await body();
		const clickDrain = gestureClickDrainMilliseconds();
		if (clickDrain > 0) await wait(clickDrain);
	} finally {
		releaseFocusLease(token, savedCursor);
	}
}

/**
 * Undo the lease only while nothing else has taken over the pointer or focus.
 *
 * A background gesture must never fight the person at the keyboard: if the pointer
 * moved or another process became frontmost while the gesture ran, that newer state
 * wins and the lease is released without restoring anything. A yanked cursor or a
 * yanked front process is human-visible interference, while a stale restore is not
 * (the app keeps the focus the human chose).
 */
function releaseFocusLease(token: FocusRestoreToken, savedCursor: Point): void {
	if (cursorIsUndisturbed(savedCursor)) {
		warpCursorPosition(savedCursor);
	}
	if (frontProcessIs(token.targetPsn)) {
		restoreFrontProcessNoWindows(token);
	}
}

function cursorIsUndisturbed(savedCursor: Point): boolean {
	try {
		const current = getCurrentCursorPosition();
		return current.x === savedCursor.x && current.y === savedCursor.y;
	} catch {
		return false;
	}
}

function frontProcessIs(psn: Buffer): boolean {
	try {
		const current = frontProcessSerialNumber();
		return current !== null && processSerialNumbersMatch(current, psn);
	} catch {
		return false;
	}
}
