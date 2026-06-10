import type { Size } from "../types/index.js";

export interface DisplayMetadata {
	readonly width: number;
	readonly height: number;
	readonly scaleFactor: number;
}

export interface DisplayMetadataInput {
	readonly logical: Size;
	readonly nativePixel?: Size;
}

export function resolveDisplayMetadata(input: DisplayMetadataInput): DisplayMetadata {
	const width = Math.round(input.logical.width);
	const height = Math.round(input.logical.height);
	return { width, height, scaleFactor: resolveScaleFactor(width, input.nativePixel) };
}

function resolveScaleFactor(logicalWidth: number, nativePixel: Size | undefined): number {
	if (nativePixel === undefined || logicalWidth <= 0) {
		return 1;
	}
	const ratio = Math.round(nativePixel.width / logicalWidth);
	return ratio >= 1 ? ratio : 1;
}
