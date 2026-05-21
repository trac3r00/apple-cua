import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KoffiFunc } from "koffi";
import { koffi } from "./koffi.js";

type SckBindings = {
	readonly capture: KoffiFunc<
		(
			width: number,
			height: number,
			outBytes: [Buffer | null],
			outLen: [number],
			outWidth: [number],
			outHeight: [number],
		) => number
	>;
	readonly freeBytes: KoffiFunc<(bytes: Buffer) => void>;
	readonly invalidateCache: KoffiFunc<() => void>;
};

const SCK_OK = 0;
const SCK_ERR_NO_SHAREABLE_CONTENT = -1;
const SCK_ERR_NO_DISPLAY = -2;
const SCK_ERR_CAPTURE_FAILED = -3;
const SCK_ERR_ENCODE_FAILED = -4;
const SCK_ERR_INVALID_ARGS = -5;
const SCK_ERR_TIMEOUT = -6;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const sckitDylibCandidatePaths: readonly string[] = [
	join(moduleDirectory, "../../../native/libsckit.dylib"),
	join(moduleDirectory, "../../../../native/libsckit.dylib"),
	join(moduleDirectory, "../../native/libsckit.dylib"),
];

let cachedBindings: SckBindings | null = null;
let bindingsLoadAttempted = false;
let loadErrorMessage = "";

function tryLoadSckitBindings(): SckBindings | null {
	if (bindingsLoadAttempted) {
		return cachedBindings;
	}
	bindingsLoadAttempted = true;

	for (const candidatePath of sckitDylibCandidatePaths) {
		try {
			const library = koffi.load(candidatePath);
			const capture = library.func("sck_capture_main_display_png", "int", [
				"int",
				"int",
				koffi.out("uint8_t **"),
				koffi.out("size_t *"),
				koffi.out("int *"),
				koffi.out("int *"),
			]) as SckBindings["capture"];
			const freeBytes = library.func("sck_free", "void", ["uint8_t *"]) as SckBindings["freeBytes"];
			const invalidateCache = library.func("sck_invalidate_cache", "void", []) as SckBindings["invalidateCache"];
			cachedBindings = { capture, freeBytes, invalidateCache };
			return cachedBindings;
		} catch (error) {
			loadErrorMessage = error instanceof Error ? error.message : String(error);
		}
	}
	return null;
}

export function isSckitAvailable(): boolean {
	return tryLoadSckitBindings() !== null;
}

export function getSckitLoadError(): string {
	tryLoadSckitBindings();
	return cachedBindings === null ? loadErrorMessage : "";
}

export type SckCapturedScreenshot = {
	readonly data: Buffer;
	readonly width: number;
	readonly height: number;
};

export function captureMainDisplayPngViaSck(targetWidth: number, targetHeight: number): SckCapturedScreenshot | null {
	const bindings = tryLoadSckitBindings();
	if (bindings === null) {
		return null;
	}
	if (!Number.isSafeInteger(targetWidth) || !Number.isSafeInteger(targetHeight)) {
		throw new Error("captureMainDisplayPngViaSck requires integer dimensions");
	}
	if (targetWidth <= 0 || targetHeight <= 0) {
		throw new Error(`captureMainDisplayPngViaSck requires positive dimensions, got ${targetWidth}x${targetHeight}`);
	}

	const outBytes: [Buffer | null] = [null];
	const outLen: [number] = [0];
	const outWidth: [number] = [0];
	const outHeight: [number] = [0];

	const resultCode = bindings.capture(targetWidth, targetHeight, outBytes, outLen, outWidth, outHeight);
	if (resultCode !== SCK_OK) {
		throw new Error(`SCK capture failed: ${describeSckError(resultCode)} (code ${resultCode})`);
	}

	const bytesPointer = outBytes[0];
	const byteLength = outLen[0];
	if (bytesPointer === null || byteLength <= 0) {
		throw new Error("SCK capture returned no data");
	}

	try {
		const decoded: ArrayLike<number> = koffi.decode(bytesPointer, "uint8_t", byteLength);
		return {
			data: Buffer.from(decoded),
			width: outWidth[0],
			height: outHeight[0],
		};
	} finally {
		bindings.freeBytes(bytesPointer);
	}
}

export function invalidateSckitCache(): void {
	const bindings = tryLoadSckitBindings();
	if (bindings !== null) {
		bindings.invalidateCache();
	}
}

function describeSckError(code: number): string {
	switch (code) {
		case SCK_ERR_NO_SHAREABLE_CONTENT:
			return "no shareable content available";
		case SCK_ERR_NO_DISPLAY:
			return "no display matched";
		case SCK_ERR_CAPTURE_FAILED:
			return "ScreenCaptureKit capture failed";
		case SCK_ERR_ENCODE_FAILED:
			return "PNG encode failed";
		case SCK_ERR_INVALID_ARGS:
			return "invalid arguments";
		case SCK_ERR_TIMEOUT:
			return "ScreenCaptureKit timed out";
		default:
			return "unknown SCK error";
	}
}
