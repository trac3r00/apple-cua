import type { ScreenshotResult } from "../computer/interface.js";
import type { Point, Rect, Size } from "../types/index.js";
import type { OcrTextObservation } from "./macos-ffi/vision.js";

function guestViewport(displayRect: Rect, guestSize: Size): { readonly rect: Rect; readonly scale: number } {
	if (
		![displayRect.x, displayRect.y, displayRect.width, displayRect.height, guestSize.width, guestSize.height].every(
			Number.isFinite,
		) ||
		displayRect.width <= 0 ||
		displayRect.height <= 0 ||
		guestSize.width <= 0 ||
		guestSize.height <= 0
	) {
		throw new RangeError("UTM display and guest dimensions must be finite and positive");
	}
	const scale = Math.min(displayRect.width / guestSize.width, displayRect.height / guestSize.height);
	return {
		scale,
		rect: {
			x: displayRect.x + (displayRect.width - guestSize.width * scale) / 2,
			y: displayRect.y + (displayRect.height - guestSize.height * scale) / 2,
			width: guestSize.width * scale,
			height: guestSize.height * scale,
		},
	};
}

function requireInside(point: Point, rect: Rect): void {
	if (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < rect.x ||
		point.y < rect.y ||
		point.x >= rect.x + rect.width ||
		point.y >= rect.y + rect.height
	) {
		throw new RangeError("Point is outside the UTM guest display");
	}
}

/** Map screenshot pixels to guest pixels. Chrome, letterboxing, and right/bottom edges are refused. */
export function mapUtmPoint(imagePoint: Point, displayRect: Rect, guestSize: Size): Point {
	const { rect, scale } = guestViewport(displayRect, guestSize);
	requireInside(imagePoint, rect);
	return { x: (imagePoint.x - rect.x) / scale, y: (imagePoint.y - rect.y) / scale };
}

/** Inverse of mapUtmPoint; coordinates remain continuous, without rounding to integer pixels. */
export function mapGuestPoint(guestPoint: Point, displayRect: Rect, guestSize: Size): Point {
	const { rect, scale } = guestViewport(displayRect, guestSize);
	requireInside(guestPoint, { x: 0, y: 0, ...guestSize });
	return { x: rect.x + guestPoint.x * scale, y: rect.y + guestPoint.y * scale };
}

/** Capture one exact UTM window, retaining chrome while exposing guest-space OCR boxes. */
export async function captureUtmDisplay(
	windowId: number,
	guestSize: Size,
): Promise<{
	readonly image: ScreenshotResult;
	readonly displayRect: Rect;
	readonly texts: readonly OcrTextObservation[];
	readonly windowId: number;
}> {
	if (!Number.isSafeInteger(windowId) || windowId <= 0) {
		throw new RangeError("A positive exact UTM window identifier is required");
	}
	guestViewport({ x: 0, y: 0, ...guestSize }, guestSize);
	const { findRunningApplication } = await import("./macos-ffi/workspace.js");
	const app = findRunningApplication("com.utmapp.UTM");
	if (app === undefined) throw new Error("UTM is not running");
	const { MacOSHostComputer } = await import("./macos.js");
	const computer = new MacOSHostComputer({ delivery: "background" });
	try {
		const state = await computer.getAppState(app.pid, {
			windowId,
			requireWindow: true,
			includeScreenshot: true,
			includeAccessibilityTree: true,
			diffOnly: false,
			settleMs: 0,
			probe: true,
		});
		if (state.windowId !== windowId || state.pid !== app.pid || state.windowBounds === undefined) {
			throw new Error("UTM observation did not capture the exact requested window");
		}
		if (state.screenshotBase64.length === 0 || state.screenshotWidth <= 0 || state.screenshotHeight <= 0) {
			throw new Error("UTM window screenshot is unavailable");
		}
		const groups = state.elements.filter(
			(element) => element.role === "AXGroup" && element.label === "Virtual Machine",
		);
		const group = groups[0];
		if (groups.length !== 1 || group === undefined) {
			throw new Error("Expected exactly one Virtual Machine AXGroup in the UTM window");
		}
		const displayRect = { ...group.frame };
		const { rect, scale } = guestViewport(displayRect, guestSize);
		if (
			displayRect.x < 0 ||
			displayRect.y < 0 ||
			displayRect.x + displayRect.width > state.screenshotWidth ||
			displayRect.y + displayRect.height > state.screenshotHeight
		) {
			throw new Error("UTM display frame is outside the captured window");
		}
		const image: ScreenshotResult = {
			data: Buffer.from(state.screenshotBase64, "base64"),
			mimeType: state.screenshotMimeType ?? "image/png",
			width: state.screenshotWidth,
			height: state.screenshotHeight,
		};
		const { recognizeTextInImage } = await import("./macos-ffi/vision.js");
		const texts = recognizeTextInImage(image.data, { region: displayRect }).flatMap((entry) => {
			// Clip OCR boxes to guest content, excluding letterboxing without changing the host image.
			const left = Math.max(entry.box.x, rect.x);
			const top = Math.max(entry.box.y, rect.y);
			const right = Math.min(entry.box.x + entry.box.width, rect.x + rect.width);
			const bottom = Math.min(entry.box.y + entry.box.height, rect.y + rect.height);
			if (right <= left || bottom <= top) return [];
			return [
				{
					text: entry.text,
					confidence: entry.confidence,
					box: {
						x: (left - rect.x) / scale,
						y: (top - rect.y) / scale,
						width: (right - left) / scale,
						height: (bottom - top) / scale,
					},
				},
			];
		});
		return { image, displayRect, texts, windowId };
	} finally {
		await computer.close();
	}
}
