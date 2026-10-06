import type { Rect } from "../types/index.js";

/**
 * How far a searched region is widened before it is cut out of a window capture, in screen points. Text that
 * touches the region's edge (a row half under the clip, a glyph whose box overhangs by antialiasing) is then
 * read whole instead of cut in half; the caller still decides by the region itself what counts as inside.
 */
export const OCR_REGION_PADDING_POINTS = 8;

/**
 * The pixels of a window capture that cover a region given in global screen points, with a top-left origin, or
 * undefined when the padded region lies wholly outside the window. The capture may be larger than the window
 * (Retina backing) or smaller (a capped long edge), so points are scaled by the capture's own pixels-per-point
 * on each axis, and the cut never leaves the image.
 */
export function resolveOcrCrop(
	region: Rect,
	windowBounds: Rect,
	imageSize: { readonly width: number; readonly height: number },
	paddingPoints: number = OCR_REGION_PADDING_POINTS,
): Rect | undefined {
	const scaleX = imageSize.width / windowBounds.width;
	const scaleY = imageSize.height / windowBounds.height;
	const left = Math.max(0, Math.floor((region.x - paddingPoints - windowBounds.x) * scaleX));
	const top = Math.max(0, Math.floor((region.y - paddingPoints - windowBounds.y) * scaleY));
	const right = Math.min(
		imageSize.width,
		Math.ceil((region.x + region.width + paddingPoints - windowBounds.x) * scaleX),
	);
	const bottom = Math.min(
		imageSize.height,
		Math.ceil((region.y + region.height + paddingPoints - windowBounds.y) * scaleY),
	);
	return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : undefined;
}
