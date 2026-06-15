import type { Point } from "../types/index.js";
import { getCurrentCursorPosition } from "./macos-ffi/coregraphics.js";

export function readRealCursorPosition(): Point {
	try {
		const position = getCurrentCursorPosition();
		return { x: Math.round(position.x), y: Math.round(position.y) };
	} catch {
		return { x: 0, y: 0 };
	}
}
