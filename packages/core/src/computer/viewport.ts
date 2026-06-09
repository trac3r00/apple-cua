import type { Point, Rect, Size } from "../types/index.js";

/** Longest screenshot edge sent to the model, matching the native full-display path. */
export const MAX_SCREENSHOT_LONG_EDGE = 1280;

/**
 * Everything needed to translate between the window screenshot the model sees and
 * the host's global logical screen coordinates.
 *
 * `get_app_state` captures a screenshot of a single app window, so the model's
 * coordinates are pixels relative to that window image — not global screen
 * points. Clicking, dragging, and reading the accessibility tree all need this
 * viewport to convert between the two spaces.
 */
export interface ScreenshotViewport {
	/** Target window rect in global logical screen points (top-left origin). */
	readonly windowBounds: Rect;
	/** Pixel width of the screenshot shown to the model. */
	readonly screenshotWidth: number;
	/** Pixel height of the screenshot shown to the model. */
	readonly screenshotHeight: number;
}

/**
 * Pixel dimensions for a window screenshot, preserving the window aspect ratio
 * and capping the long edge. Mirrors `resolveDisplayConfig` for the full display
 * so window and display screenshots scale the same way.
 */
export function resolveWindowScreenshotSize(window: Size, maxLongEdge = MAX_SCREENSHOT_LONG_EDGE): Size {
	const width = assertPositiveFinite(window.width, "width");
	const height = assertPositiveFinite(window.height, "height");
	const longEdge = Math.max(width, height);
	if (longEdge <= maxLongEdge) {
		return { width: Math.round(width), height: Math.round(height) };
	}
	const scale = maxLongEdge / longEdge;
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
	};
}

/**
 * Map a screenshot pixel coordinate (relative to the window screenshot) to a
 * global logical screen point. Pixels that fall outside the screenshot are
 * clamped back onto the window rect so a click can never resolve a neighbouring
 * window or the desktop.
 */
export function screenshotPointToScreen(point: Point, viewport: ScreenshotViewport): Point {
	const { windowBounds } = viewport;
	const screenshotWidth = assertPositiveFinite(viewport.screenshotWidth, "screenshotWidth");
	const screenshotHeight = assertPositiveFinite(viewport.screenshotHeight, "screenshotHeight");
	const fractionX = clamp(point.x / screenshotWidth, 0, 1);
	const fractionY = clamp(point.y / screenshotHeight, 0, 1);
	return {
		x: Math.round(windowBounds.x + fractionX * windowBounds.width),
		y: Math.round(windowBounds.y + fractionY * windowBounds.height),
	};
}

/**
 * Map a global-screen accessibility frame into the window screenshot's pixel
 * space, so the accessibility tree the model reads shares one coordinate system
 * with the screenshot it clicks in. The inverse of {@link screenshotPointToScreen}.
 */
export function screenRectToScreenshot(frame: Rect, viewport: ScreenshotViewport): Rect {
	const { windowBounds } = viewport;
	const scaleX = viewport.screenshotWidth / assertPositiveFinite(windowBounds.width, "windowBounds.width");
	const scaleY = viewport.screenshotHeight / assertPositiveFinite(windowBounds.height, "windowBounds.height");
	return {
		x: Math.round((frame.x - windowBounds.x) * scaleX),
		y: Math.round((frame.y - windowBounds.y) * scaleY),
		width: Math.round(frame.width * scaleX),
		height: Math.round(frame.height * scaleY),
	};
}

function assertPositiveFinite(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive finite number`);
	}
	return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
