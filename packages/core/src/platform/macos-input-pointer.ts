import { setTimeout as sleep } from "node:timers/promises";
import type { DragOptions, Point } from "../types/index.js";
import type { MouseButton } from "./macos-ffi/coregraphics.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";
import { dragSteps, interpolatePoint } from "./macos-input-drag.js";
import { runFocusLeasedGesture } from "./macos-targeted-gesture.js";

export type MousePost = (
	kind: "move" | "down" | "up" | "drag",
	position: Point,
	button: MouseButton,
	clickState: number | undefined,
	targetWindow: SkyLightTargetWindow | undefined,
) => Promise<void>;

export async function postClick(
	post: MousePost,
	position: Point,
	button: MouseButton,
	clickState: number,
	targetWindow: SkyLightTargetWindow | undefined,
): Promise<void> {
	await post("down", position, button, clickState, targetWindow);
	await post("up", position, button, clickState, targetWindow);
}

export async function postDoubleClick(
	post: MousePost,
	position: Point,
	targetWindow: SkyLightTargetWindow | undefined,
): Promise<void> {
	await postClick(post, position, "left", 1, targetWindow);
	await postClick(post, position, "left", 2, targetWindow);
}

export async function postDragSequence(
	post: MousePost,
	options: DragOptions,
	targetWindow: SkyLightTargetWindow | undefined,
): Promise<void> {
	await post("down", options.from, "left", 1, targetWindow);
	const duration = options.duration ?? 0;
	const steps = dragSteps(duration);
	const delay = steps <= 1 ? 0 : duration / steps;
	for (let step = 1; step <= steps; step += 1) {
		const position = interpolatePoint(options.from, options.to, step / steps);
		await post("drag", position, "left", 1, targetWindow);
		if (delay > 0 && step < steps) {
			await sleep(delay);
		}
	}
	await post("up", options.to, "left", 1, targetWindow);
}

export async function runFocusLeasedClick(
	targetWindow: SkyLightTargetWindow,
	position: Point,
	button: MouseButton,
	post: MousePost,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, position, post, () => postClick(post, position, button, 1, targetWindow));
}

export async function runFocusLeasedDoubleClick(
	targetWindow: SkyLightTargetWindow,
	position: Point,
	post: MousePost,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, position, post, () => postDoubleClick(post, position, targetWindow));
}

export async function runFocusLeasedDrag(
	targetWindow: SkyLightTargetWindow,
	options: DragOptions,
	post: MousePost,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, options.from, post, () => postDragSequence(post, options, targetWindow));
}
