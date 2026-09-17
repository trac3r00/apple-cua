import type { Point } from "../types/index.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";

/**
 * A window this driver can target. Deliberately its own shape rather than the helper binary's
 * result type: the in-process WindowServer listing and the get-windows fallback both map into
 * it, so callers do not depend on which one answered.
 */
export interface MacOSWindowInfo {
	readonly id: number;
	readonly bounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
	readonly owner?: {
		readonly processId?: number;
		readonly name?: string;
	} | null;
	readonly title?: string | null;
	readonly layer?: number | null;
}

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

export type TargetWindowResolution =
	| { readonly kind: "resolved"; readonly window: SkyLightTargetWindow }
	| { readonly kind: "unavailable"; readonly reason: string };

/**
 * Resolve the window input should go to, proven against the WindowServer rather than assumed.
 * An explicit `windowId` is authoritative: when it is gone, or the WindowServer does not
 * report it on screen, the answer is a refusal with a reason instead of another window of the
 * same app. Without an id, only on-screen windows are candidates, `onscreenWindowIds` is in
 * the WindowServer's front-to-back order, so a position picks the window under it and the
 * fallback is the app's front window rather than whatever order the listing returned.
 */
export function resolveTargetWindow(
	windows: readonly MacOSWindowInfo[],
	pid: number,
	onscreenWindowIds: readonly number[] | undefined,
	position?: Point,
	windowId?: number,
): TargetWindowResolution {
	if (onscreenWindowIds === undefined) {
		return {
			kind: "unavailable",
			reason: "the on-screen window list could not be read from the WindowServer; targeted input is paused",
		};
	}
	const frontToBack = new Map(onscreenWindowIds.map((id, index) => [id, index] as const));
	const visibleWindows = visibleWindowsForPid(windows, pid);
	const onscreen = visibleWindows.filter((window) => frontToBack.has(window.id));

	if (windowId !== undefined) {
		const requested = visibleWindows.find((window) => window.id === windowId);
		if (requested === undefined) {
			return { kind: "unavailable", reason: `window ${windowId} is no longer open for this app` };
		}
		if (!frontToBack.has(windowId)) {
			return {
				kind: "unavailable",
				reason: `window ${windowId} is not on the current space; it may be minimized or on another space`,
			};
		}
		return { kind: "resolved", window: toTargetWindow(requested) };
	}

	if (onscreen.length === 0) {
		return {
			kind: "unavailable",
			reason: "this app has no window on the current space; its windows may be minimized or on another space",
		};
	}

	const containing = position === undefined ? undefined : onscreen.find((window) => containsPoint(window, position));
	const ordered = [...onscreen].sort(
		(left, right) =>
			(frontToBack.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (frontToBack.get(right.id) ?? Number.MAX_SAFE_INTEGER),
	);
	const target = containing ?? ordered[0];
	if (target === undefined) {
		return { kind: "unavailable", reason: "this app has no window on the current space" };
	}
	return { kind: "resolved", window: toTargetWindow(target) };
}

function containsPoint(window: MacOSWindowInfo, position: Point): boolean {
	return (
		position.x >= window.bounds.x &&
		position.x <= window.bounds.x + window.bounds.width &&
		position.y >= window.bounds.y &&
		position.y <= window.bounds.y + window.bounds.height
	);
}
