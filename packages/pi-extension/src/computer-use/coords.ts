const MAX_MODEL_LONG_EDGE = 1280;

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

function assertPositiveFiniteDimension(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive finite number`);
	}
	return Math.round(value);
}
