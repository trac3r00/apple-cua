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

export function selectVisibleTargetWindow(
	windows: readonly MacOSWindowInfo[],
	pid: number,
	position?: Point,
): SkyLightTargetWindow | undefined {
	const visibleWindows = windows.filter(
		(window) => window.owner?.processId === pid && window.bounds.width > 0 && window.bounds.height > 0,
	);
	const containingTarget =
		position === undefined ? undefined : visibleWindows.find((window) => containsPoint(window, position));
	const target = containingTarget ?? visibleWindows[0];
	if (target === undefined) {
		return undefined;
	}
	return {
		id: target.id,
		bounds: {
			x: target.bounds.x,
			y: target.bounds.y,
			width: target.bounds.width,
			height: target.bounds.height,
		},
	};
}

function containsPoint(window: MacOSWindowInfo, position: Point): boolean {
	return (
		position.x >= window.bounds.x &&
		position.x <= window.bounds.x + window.bounds.width &&
		position.y >= window.bounds.y &&
		position.y <= window.bounds.y + window.bounds.height
	);
}
