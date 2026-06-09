import type { Point } from "../types/index.js";
import type { ComputerInterface } from "./interface.js";
import { screenshotPointToScreen } from "./viewport.js";

/**
 * Map a model-supplied window-screenshot pixel coordinate to a global logical
 * screen point via the target app's viewport, or pass it through when no
 * viewport is known. Input dispatch expects global points; the model sees window
 * pixels.
 */
export async function resolveScreenPoint(computer: ComputerInterface, targetPid: number, point: Point): Promise<Point> {
	const viewport = await computer.getScreenshotViewport(targetPid);
	if (viewport === undefined) {
		return point;
	}
	return screenshotPointToScreen(point, viewport);
}
