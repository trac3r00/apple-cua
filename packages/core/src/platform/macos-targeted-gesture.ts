import { setTimeout as sleep } from "node:timers/promises";
import type { Point } from "../types/index.js";
import { type MouseButton, getCurrentCursorPosition, warpCursorPosition } from "./macos-ffi/coregraphics.js";
import {
	type SkyLightTargetWindow,
	beginFocusWithoutRaise,
	restoreFrontProcessNoWindows,
} from "./macos-ffi/skylight.js";

const FOCUS_SETTLE_MILLISECONDS = 50;
const HOVER_MILLISECONDS = 15;
const PRIMER_GAP_MILLISECONDS = 1;
const PRIMER_TO_CLICK_MILLISECONDS = 100;
const CLICK_DRAIN_MILLISECONDS = 50;
const OFFSCREEN_PRIMER: Point = { x: -1, y: -1 };

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
): Promise<void> {
	const savedCursor = getCurrentCursorPosition();
	const token = beginFocusWithoutRaise(targetWindow);
	if (token === null) {
		throw new Error("failed to activate target window without raising it");
	}
	try {
		await sleep(FOCUS_SETTLE_MILLISECONDS);
		await post("move", hoverPosition, "left", undefined, targetWindow);
		await sleep(HOVER_MILLISECONDS);
		await post("down", OFFSCREEN_PRIMER, "left", 1, targetWindow);
		await sleep(PRIMER_GAP_MILLISECONDS);
		await post("up", OFFSCREEN_PRIMER, "left", 1, targetWindow);
		await sleep(PRIMER_TO_CLICK_MILLISECONDS);
		await body();
		await sleep(CLICK_DRAIN_MILLISECONDS);
	} finally {
		warpCursorPosition(savedCursor);
		restoreFrontProcessNoWindows(token);
	}
}
