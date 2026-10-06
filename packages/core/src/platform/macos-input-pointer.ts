import { setTimeout as sleep } from "node:timers/promises";
import type { DragOptions, Point, Rect } from "../types/index.js";
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

/** Every display and on-screen window in global points: what the activation primer must not land on. */
export interface ScreenLayout {
	readonly displays: readonly Rect[];
	readonly windows: readonly Rect[];
}

/** Just above and left of the main display, which is clear on most arrangements. */
const PRIMER_USUAL_POSITION: Point = { x: -1, y: -1 };
const PRIMER_GAP_MILLISECONDS = 1;
const PRIMER_SETTLE_MILLISECONDS = 100;

/**
 * Where the activation primer can click without landing on anything: a point inside no display and no on-screen
 * window. That is (-1, -1) unless a display arranged above or left of the main one, or a window, covers it; then it is
 * the point just above and left of every display and window. Undefined when no point is provably clear: the layout is
 * unknown, names no display, or holds a bound that is not a finite rectangle.
 */
export function primerPosition(layout: ScreenLayout | undefined): Point | undefined {
	if (layout === undefined || layout.displays.length === 0) {
		return undefined;
	}
	const rects = [...layout.displays, ...layout.windows];
	if (!rects.every(isFiniteRect)) {
		return undefined;
	}
	const candidate = rects.some((rect) => covers(rect, PRIMER_USUAL_POSITION))
		? {
				x: Math.min(...rects.map((rect) => rect.x)) - 1,
				y: Math.min(...rects.map((rect) => rect.y)) - 1,
			}
		: PRIMER_USUAL_POSITION;
	// Checked again rather than trusted: past 2^53 subtracting 1 no longer moves a coordinate.
	return rects.some((rect) => covers(rect, candidate)) ? undefined : candidate;
}

function isFiniteRect(rect: Rect): boolean {
	return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0;
}

/** Edges count as covered, so a point on a window's border is never taken as clear. */
function covers(rect: Rect, point: Point): boolean {
	return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/**
 * The first click an app gets after it is told it is active is spent on that activation and does nothing. A click at
 * `position`, a point inside no display and no window (see primerPosition), absorbs it, so the gesture's own first
 * click lands. It goes to the target app's window like the gesture, never to whatever is on screen there.
 */
export async function postActivationPrimer(
	post: MousePost,
	targetWindow: SkyLightTargetWindow,
	position: Point,
): Promise<void> {
	await post("down", position, "left", 1, targetWindow);
	await sleep(PRIMER_GAP_MILLISECONDS);
	await post("up", position, "left", 1, targetWindow);
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

/**
 * Press at `from`, move to `to` and release. `checkpoint` is called before every move and throws to stop the drag:
 * the button is then released where the pointer is, and nothing else is sent, so the app is never left mid-drag.
 */
export async function postDragSequence(
	post: MousePost,
	options: DragOptions,
	targetWindow: SkyLightTargetWindow | undefined,
	flags?: number,
	checkpoint: () => void = () => undefined,
): Promise<void> {
	await post("down", options.from, "left", 1, targetWindow, flags);
	const duration = options.duration ?? 0;
	const steps = dragSteps(duration);
	const delay = steps <= 1 ? 0 : duration / steps;
	let at = options.from;
	try {
		for (let step = 1; step <= steps; step += 1) {
			checkpoint();
			const position = interpolatePointEased(options.from, options.to, step / steps);
			await post("drag", position, "left", 1, targetWindow, flags);
			at = position;
			if (delay > 0 && step < steps) {
				await sleep(delay);
			}
		}
	} catch (error: unknown) {
		await post("up", at, "left", 1, targetWindow, flags);
		throw error;
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
	checkpoint?: () => void,
): Promise<void> {
	await runFocusLeasedGesture(targetWindow, options.from, post, () =>
		postDragSequence(post, options, targetWindow, flags, checkpoint),
	);
}
