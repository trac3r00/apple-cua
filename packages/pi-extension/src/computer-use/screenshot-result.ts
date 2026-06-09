import type { ComputerInterface, Point, ScreenshotResult } from "@macos-cua/core";
import { PNG } from "pngjs";

import type { ComputerUseResult } from "../anthropic-computer-use.js";
import type { DisplayConfig } from "./coords.js";

const CURSOR_FILL = { red: 255, green: 59, blue: 48, alpha: 255 } as const;
const CURSOR_RING = { red: 255, green: 255, blue: 255, alpha: 255 } as const;
const CURSOR_RADIUS_PIXELS = 5;
const CURSOR_RING_RADIUS_PIXELS = 7;

type CursorScreenshotComputer = Pick<ComputerInterface, "getCursorPosition" | "screenshot">;
type Rgba = {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
	readonly alpha: number;
};

export async function screenshotResultWithCursor(
	computer: CursorScreenshotComputer,
	display: DisplayConfig,
): Promise<ComputerUseResult> {
	const screenshot = await computer.screenshot({
		targetSize: { width: display.modelWidth, height: display.modelHeight },
	});
	const cursor = await computer.getCursorPosition();
	return imageResult(drawCursorOnScreenshot(screenshot, cursor, display).toString("base64"));
}

export function drawCursorOnScreenshot(screenshot: ScreenshotResult, cursor: Point, display: DisplayConfig): Buffer {
	const png = decodePngOrUndefined(screenshot.data);
	if (png === undefined) {
		return screenshot.data;
	}
	const center = cursorImagePoint(cursor, display, { width: png.width, height: png.height });
	drawDisc(png, center, CURSOR_RING_RADIUS_PIXELS, CURSOR_RING);
	drawDisc(png, center, CURSOR_RADIUS_PIXELS, CURSOR_FILL);
	return PNG.sync.write(png);
}

function imageResult(pngBase64: string): ComputerUseResult {
	return { content: [{ type: "image", data: pngBase64, mimeType: "image/png" }], details: undefined };
}

function cursorImagePoint(
	cursor: Point,
	display: DisplayConfig,
	imageSize: { readonly width: number; readonly height: number },
): Point {
	return {
		x: clamp(Math.round(cursor.x * (imageSize.width / display.logicalWidth)), 0, imageSize.width - 1),
		y: clamp(Math.round(cursor.y * (imageSize.height / display.logicalHeight)), 0, imageSize.height - 1),
	};
}

function drawDisc(png: PNG, center: Point, radius: number, color: Rgba): void {
	const minX = clamp(Math.floor(center.x - radius), 0, png.width - 1);
	const maxX = clamp(Math.ceil(center.x + radius), 0, png.width - 1);
	const minY = clamp(Math.floor(center.y - radius), 0, png.height - 1);
	const maxY = clamp(Math.ceil(center.y + radius), 0, png.height - 1);
	const radiusSquared = radius * radius;

	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const dx = x - center.x;
			const dy = y - center.y;
			if (dx * dx + dy * dy <= radiusSquared) {
				setPixel(png, x, y, color);
			}
		}
	}
}

function setPixel(png: PNG, x: number, y: number, color: Rgba): void {
	const offset = (png.width * y + x) * 4;
	png.data[offset] = color.red;
	png.data[offset + 1] = color.green;
	png.data[offset + 2] = color.blue;
	png.data[offset + 3] = color.alpha;
}

function decodePngOrUndefined(data: Buffer): PNG | undefined {
	try {
		return PNG.sync.read(data);
	} catch (error) {
		if (error instanceof Error) {
			return undefined;
		}
		throw error;
	}
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
