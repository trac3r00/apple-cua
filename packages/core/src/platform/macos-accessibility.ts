import type { AXTreeElement } from "../accessibility/types.js";
import type { Point } from "../types/index.js";

export function resolveElementCoordinate(elements: readonly AXTreeElement[], elementIndex: number): Point {
	const element = elements.find((candidate) => candidate.id === elementIndex);
	if (element === undefined) {
		throw new Error(`Element index ${elementIndex} not found in AX tree`);
	}
	if (element.frame.width <= 0 || element.frame.height <= 0) {
		throw new Error(`Element ${elementIndex} has zero-size frame`);
	}
	return {
		x: Math.round(element.frame.x + element.frame.width / 2),
		y: Math.round(element.frame.y + element.frame.height / 2),
	};
}
