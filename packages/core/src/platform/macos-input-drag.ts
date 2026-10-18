import type { Point } from "../types/index.js";

const DEFAULT_DRAG_FRAME_MILLISECONDS = 16;

/** Distance-based travel time in milliseconds, bounded so large displays do not create long gestures. */
export function pointerTravelDuration(from: Point, to: Point): number {
	const distance = Math.hypot(to.x - from.x, to.y - from.y);
	return distance === 0 ? 0 : Math.min(600, Math.max(120, distance * 0.6));
}

export function dragSteps(duration: number): number {
	if (duration <= 0) {
		return 1;
	}
	return Math.max(1, Math.ceil(duration / DEFAULT_DRAG_FRAME_MILLISECONDS));
}

function interpolatePoint(from: Point, to: Point, progress: number): Point {
	return {
		x: Math.round(from.x + (to.x - from.x) * progress),
		y: Math.round(from.y + (to.y - from.y) * progress),
	};
}

/**
 * Velocity profile of a hand: still at the start, fastest in the middle, still again at the end.
 * Smoothstep, so the pointer accelerates out of the press instead of leaving at full speed and
 * stopping dead on arrival — which is what reads as "robotic" to a human watching the cursor.
 */
export function easedProgress(progress: number): number {
	const clamped = Math.min(1, Math.max(0, progress));
	return clamped * clamped * (3 - 2 * clamped);
}

/** {@link interpolatePoint} along the eased profile, for drags and swipes. */
export function interpolatePointEased(from: Point, to: Point, progress: number): Point {
	return interpolatePoint(from, to, easedProgress(progress));
}
