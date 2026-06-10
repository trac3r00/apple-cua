import type { AXTreeElement } from "./types.js";

export function stableElementKey(element: AXTreeElement): string {
	const frame = `${element.frame.x},${element.frame.y},${element.frame.width},${element.frame.height}`;
	return [element.role, element.label ?? "", frame].join("|");
}
