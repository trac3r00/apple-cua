import { AsyncLocalStorage } from "node:async_hooks";
import type { Point, Rect } from "../types/index.js";

/**
 * The part of a shared window one worker may touch, in global screen points. Set by the coordinator around a confined
 * worker's dispatch and read by the lowest input layer, so a pointer event or keystroke outside it is refused right
 * before it would be posted, whatever moved in between.
 */
const regions = new AsyncLocalStorage<Readonly<Rect>>();

/** Raised when input would land outside the confined worker's region; nothing of that event was posted. */
export class InputOutsideRegion extends Error {
	readonly code = "INPUT_OUTSIDE_WORKER_REGION";

	constructor(detail: string) {
		super(`${detail}, outside the worker's region; nothing was posted for it`);
		this.name = "InputOutsideRegion";
	}
}

/** Run `action` with `region` (global screen points) confining every pointer event and keystroke it posts. */
export function withInputRegion<T>(region: Rect, action: () => T): T {
	return regions.run(Object.freeze({ ...region }), action);
}

export function currentInputRegion(): Readonly<Rect> | undefined {
	return regions.getStore();
}

/** Half-open: the right and bottom edges belong to the next region. */
function contains(region: Readonly<Rect>, point: Point): boolean {
	return (
		point.x >= region.x &&
		point.x < region.x + region.width &&
		point.y >= region.y &&
		point.y < region.y + region.height
	);
}

/** Refuses a pointer event outside the current region; no-op when the flow is not confined. */
export function assertPointInInputRegion(point: Point, what: string): void {
	const region = currentInputRegion();
	if (region === undefined || contains(region, point)) return;
	throw new InputOutsideRegion(`${what} at (${Math.round(point.x)}, ${Math.round(point.y)})`);
}

/**
 * Refuses a keystroke whose focused element is not inside the current region: keys go wherever focus is, so another
 * worker's click elsewhere in the window would otherwise send this worker's typing into that worker's area. A focus
 * that cannot be read is refused too. No-op when the flow is not confined.
 */
export function assertFocusInInputRegion(readFocusedFrame: () => Rect | undefined): void {
	const region = currentInputRegion();
	if (region === undefined) return;
	const frame = readFocusedFrame();
	if (frame === undefined || !(frame.width > 0 && frame.height > 0)) {
		throw new InputOutsideRegion("keyboard input with no readable focused element");
	}
	const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
	if (!contains(region, center)) {
		throw new InputOutsideRegion(
			`keyboard input to the focused element centred at (${Math.round(center.x)}, ${Math.round(center.y)})`,
		);
	}
}
