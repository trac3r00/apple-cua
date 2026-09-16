import type { AXTreeElement } from "./types.js";

/**
 * Content identity for matching elements between two walks. The frame's x position and
 * width are deliberately excluded: on live lists (Finder, Mail) those change between
 * identical walks as cells re-truncate their text, while role, label and vertical position
 * stay put. Matching on role, label and y therefore compares like with like; a control that
 * really moved vertically is reported as removed plus added, which is the truth.
 */
export function stableElementKey(element: AXTreeElement): string {
	return [element.role, element.label ?? "", Math.round(element.frame.y)].join("|");
}
