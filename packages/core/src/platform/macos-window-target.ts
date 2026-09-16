import type { openWindows } from "get-windows";
import type { Point } from "../types/index.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";

type OpenWindowResult = Awaited<ReturnType<typeof openWindows>>[number];

export type MacOSWindowInfo = {
	readonly id: number;
	readonly bounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
	readonly owner?: {
		readonly processId?: number;
	} | null;
} & OpenWindowResult;

export function visibleWindowsForPid(windows: readonly MacOSWindowInfo[], pid: number): readonly MacOSWindowInfo[] {
	return windows.filter(
		(window) => window.owner?.processId === pid && window.bounds.width > 0 && window.bounds.height > 0,
	);
}

export function toTargetWindow(window: MacOSWindowInfo): SkyLightTargetWindow {
	return {
		id: window.id,
		bounds: {
			x: window.bounds.x,
			y: window.bounds.y,
			width: window.bounds.width,
			height: window.bounds.height,
		},
	};
}

/**
 * Resolve the window input should go to. An explicit `windowId` is authoritative and never
 * falls back: when that window is gone the answer is undefined, because silently retargeting
 * another window of the same app is how input lands somewhere the caller never observed.
 * Without an id, a position picks the window under it and otherwise the first visible window
 * is a guess, so callers that need certainty pass the observed id.
 */
export function selectVisibleTargetWindow(
	windows: readonly MacOSWindowInfo[],
	pid: number,
	position?: Point,
	windowId?: number,
): SkyLightTargetWindow | undefined {
	const visibleWindows = visibleWindowsForPid(windows, pid);
	if (windowId !== undefined) {
		const requested = visibleWindows.find((window) => window.id === windowId);
		return requested === undefined ? undefined : toTargetWindow(requested);
	}
	const containingTarget =
		position === undefined ? undefined : visibleWindows.find((window) => containsPoint(window, position));
	const target = containingTarget ?? visibleWindows[0];
	return target === undefined ? undefined : toTargetWindow(target);
}

function containsPoint(window: MacOSWindowInfo, position: Point): boolean {
	return (
		position.x >= window.bounds.x &&
		position.x <= window.bounds.x + window.bounds.width &&
		position.y >= window.bounds.y &&
		position.y <= window.bounds.y + window.bounds.height
	);
}
