import type { Point } from "../types/index.js";
import { getCurrentCursorPosition } from "./macos-ffi/coregraphics.js";

const DEFAULT_DRAG_FRAME_MILLISECONDS = 16;
const MAX_DRAG_STEPS = 60;

export function dragSteps(duration: number): number {
	if (duration <= 0) {
		return 1;
	}
	return Math.max(1, Math.min(MAX_DRAG_STEPS, Math.ceil(duration / DEFAULT_DRAG_FRAME_MILLISECONDS)));
}

export function interpolatePoint(from: Point, to: Point, progress: number): Point {
	return {
		x: Math.round(from.x + (to.x - from.x) * progress),
		y: Math.round(from.y + (to.y - from.y) * progress),
	};
}

export function readRealCursorPosition(): Point {
	try {
		const position = getCurrentCursorPosition();
		return { x: Math.round(position.x), y: Math.round(position.y) };
	} catch {
		return { x: 0, y: 0 };
	}
}
