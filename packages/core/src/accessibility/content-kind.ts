import type { AXTreeElement } from "./types.js";

/**
 * Whether the accessibility tree or the screenshot is the more reliable
 * perception channel for the current screen. This is the macos-cua analogue of
 * ChatGPT computer-use's `SkyshotClassifier` ("determine if Skyshot contains
 * image or not"): when the screen is image-heavy the AX tree carries little
 * actionable structure, so the model should lean on the screenshot (vision);
 * otherwise the AX tree is the cheaper, more precise channel.
 */
export type ContentKind = "ax" | "image";

/** Roles whose pixels are photographic/graphical rather than structural. */
const IMAGE_ROLES = new Set(["AXImage", "AXImageMap", "AXCanvas"]);

/**
 * Fraction of the window covered by image-role elements above which the screen
 * is considered image-heavy. Chosen so a single hero/photo canvas flips the
 * classification while icons and thumbnails do not.
 */
const IMAGE_AREA_THRESHOLD = 0.5;

/**
 * Classify the dominant content of a window from its accessibility tree.
 *
 * - `"image"` when the tree is empty against a real window, or when image-role
 *   elements cover most of the window — vision is the reliable channel.
 * - `"ax"` otherwise — the tree has enough structure to drive by index.
 */
export function classifyContentKind(
	elements: readonly AXTreeElement[],
	window: { readonly width: number; readonly height: number },
): ContentKind {
	if (elements.length === 0) {
		return "image";
	}
	const windowArea = window.width * window.height;
	if (windowArea <= 0) {
		return "ax";
	}
	let imageArea = 0;
	for (const element of elements) {
		if (IMAGE_ROLES.has(element.role)) {
			imageArea += element.frame.width * element.frame.height;
		}
	}
	return imageArea / windowArea >= IMAGE_AREA_THRESHOLD ? "image" : "ax";
}
