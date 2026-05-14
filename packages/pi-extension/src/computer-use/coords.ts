import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_MODEL_LONG_EDGE = 1280;
const SIPS_TIMEOUT_MILLISECONDS = 10_000;

let didWarnAboutResizeFallback = false;

export interface DisplayConfig {
	/** Logical screen width in points (e.g. 2560 on a 16" MBP). */
	readonly logicalWidth: number;
	/** Logical screen height in points. */
	readonly logicalHeight: number;
	/** Resolution sent to the model (e.g. 1280). */
	readonly modelWidth: number;
	/** Resolution sent to the model (e.g. 720). */
	readonly modelHeight: number;
}

export function resolveDisplayConfig(screenSize: { readonly width: number; readonly height: number }): DisplayConfig {
	const logicalWidth = assertPositiveFiniteDimension(screenSize.width, "width");
	const logicalHeight = assertPositiveFiniteDimension(screenSize.height, "height");
	const logicalLongEdge = Math.max(logicalWidth, logicalHeight);
	if (logicalLongEdge <= MAX_MODEL_LONG_EDGE) {
		return { logicalWidth, logicalHeight, modelWidth: logicalWidth, modelHeight: logicalHeight };
	}

	const scale = MAX_MODEL_LONG_EDGE / logicalLongEdge;
	return {
		logicalWidth,
		logicalHeight,
		modelWidth: Math.max(1, Math.floor(logicalWidth * scale)),
		modelHeight: Math.max(1, Math.floor(logicalHeight * scale)),
	};
}

export function unscaleCoord(
	point: { readonly x: number; readonly y: number },
	display: DisplayConfig,
): { x: number; y: number } {
	return {
		x: Math.round(point.x * (display.logicalWidth / display.modelWidth)),
		y: Math.round(point.y * (display.logicalHeight / display.modelHeight)),
	};
}

export async function resizeScreenshotPng(rawPng: Buffer, targetWidth: number, targetHeight: number): Promise<Buffer> {
	const width = assertPositiveFiniteDimension(targetWidth, "targetWidth");
	const height = assertPositiveFiniteDimension(targetHeight, "targetHeight");
	const tempDirectory = await mkdtemp(join(tmpdir(), "macos-cua-resize-"));
	const inputPath = join(tempDirectory, "input.png");
	const outputPath = join(tempDirectory, "output.png");

	try {
		await writeFile(inputPath, rawPng);
		await execFileAsync(
			"sips",
			["-s", "format", "png", "-z", String(height), String(width), inputPath, "--out", outputPath],
			{
				encoding: "utf8",
				timeout: SIPS_TIMEOUT_MILLISECONDS,
			},
		);
		const resized = await readFile(outputPath);
		return resized.byteLength === 0 ? rawPng : resized;
	} catch (error) {
		warnAboutResizeFallback(error);
		return rawPng;
	} finally {
		await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
	}
}

function assertPositiveFiniteDimension(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive finite number`);
	}
	return Math.round(value);
}

function warnAboutResizeFallback(error: unknown): void {
	if (didWarnAboutResizeFallback) {
		return;
	}
	didWarnAboutResizeFallback = true;
	console.warn(`macos-cua: screenshot resize unavailable; returning raw PNG (${errorMessage(error)})`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
