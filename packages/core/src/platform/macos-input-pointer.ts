import { setTimeout as sleep } from "node:timers/promises";
import type { DragOptions, Point } from "../types/index.js";
import type { MouseButton } from "./macos-ffi/coregraphics.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";
import { dragSteps, interpolatePointEased } from "./macos-input-drag.js";
import { runFocusLeasedGesture } from "./macos-targeted-gesture.js";

/** `flags` is the held-modifier CGEventFlags mask to stamp on the event; undefined leaves the flags alone. */
export type MousePost = (
	kind: "move" | "down" | "up" | "drag",
	position: Point,
	button: MouseButton,
	clickState: number | undefined,
	targetWindow: SkyLightTargetWindow | undefined,
	flags?: number,
) => Promise<void>;

const PRIMER_POSITION: Point = { x: -1, y: -1 };
const PRIMER_GAP_MILLISECONDS = 1;
const PRIMER_SETTLE_MILLISECONDS = 100;

/**
 * The first click an app gets after it is told it is active is spent on that activation and does
 * nothing. A click outside every window absorbs it, so the gesture's own first click lands.
 */
export async function postActivationPrimer(post: MousePost, targetWindow: SkyLightTargetWindow): Promise<void> {
	await post("down", PRIMER_POSITION, "left", 1, targetWindow);
	await sleep(PRIMER_GAP_MILLISECONDS);
	await post("up", PRIMER_POSITION, "left", 1, targetWindow);
	await sleep(PRIMER_SETTLE_MILLISECONDS);
}

export async function postClick(
	post: MousePost,
	position: Point,
	button: MouseButton,
	clickState: number,
	targetWindow: SkyLightTargetWindow | undefined,
	flags?: number,
): Promise<void> {
	await post("down", position, button, clickState, targetWindow, flags);
	await post("up", position, button, clickState, targetWindow, flags);
}

export async function postDoubleClick(
	post: MousePost,
	position: Point,
	targetWindow: SkyLightTargetWindow | undefined,
	flags?: number,
): Promise<void> {
	await postClick(post, position, "left", 1, targetWindow, flags);
	await postClick(post, position, "left", 2, targetWindow, flags);
}

export async function postDragSequence(
	post: MousePost,
	options: DragOptions,
	targetWindow: SkyLightTargetWindow | undefined,
	flags?: number,
): Promise<void> {
	await post("down", options.from, "left", 1, targetWindow, flags);
	const duration = options.duration ?? 0;
	const steps = dragSteps(duration);
	const delay = steps <= 1 ? 0 : duration / steps;
	for (let step = 1; step <= steps; step += 1) {
		const position = interpolatePointEased(options.from, options.to, step / steps);
		await post("drag", position, "left", 1, targetWindow, flags);
		if (delay > 0 && step < steps) {
			await sleep(delay);
		}
	}
	await post("up", options.to, "left", 1, targetWindow, flags);
}

export async function runFocusLeasedClick(
	targetWindow: SkyLightTargetWindow,
	position: Point,
	button: MouseButton,
	post: MousePost,
	flags?: number,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, position, post, () =>
		postClick(post, position, button, 1, targetWindow, flags),
	);
}

export async function runFocusLeasedDoubleClick(
	targetWindow: SkyLightTargetWindow,
	position: Point,
	post: MousePost,
	flags?: number,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, position, post, () =>
		postDoubleClick(post, position, targetWindow, flags),
	);
}

export async function runFocusLeasedDrag(
	targetWindow: SkyLightTargetWindow,
	options: DragOptions,
	post: MousePost,
	flags?: number,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, options.from, post, () =>
		postDragSequence(post, options, targetWindow, flags),
	);
}
