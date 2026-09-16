import type { KoffiFunc } from "koffi";

import {
	type CFTypeRef,
	cfArrayLength,
	cfArrayValueAt,
	cfDictionaryValue,
	cfRelease,
	fromCFNumber,
	isCFNumber,
	withCFString,
} from "./corefoundation.js";
import { koffi } from "./koffi.js";

export interface OnscreenWindow {
	readonly id: number;
	readonly ownerPid: number;
	readonly layer: number;
}

const ON_SCREEN_ONLY = 1;
const EXCLUDE_DESKTOP_ELEMENTS = 16;
const NULL_WINDOW_ID = 0;

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");

let windowListBinding: KoffiFunc<(option: number, relativeToWindow: number) => CFTypeRef | null> | undefined;

function getWindowListBinding(): KoffiFunc<(option: number, relativeToWindow: number) => CFTypeRef | null> | null {
	if (windowListBinding === undefined) {
		try {
			windowListBinding = coreGraphics.func("CGWindowListCopyWindowInfo", "void *", [
				"uint32_t",
				"uint32_t",
			]) as KoffiFunc<(option: number, relativeToWindow: number) => CFTypeRef | null>;
		} catch {
			return null;
		}
	}
	return windowListBinding;
}

const WINDOW_NUMBER_KEY = "kCGWindowNumber";
const WINDOW_OWNER_PID_KEY = "kCGWindowOwnerPID";
const WINDOW_LAYER_KEY = "kCGWindowLayer";

/**
 * On-screen membership is the only public proof that a window exists, is owned by the process
 * it claims, and sits on the current Space rather than minimized or parked on another one.
 * Returns undefined when the list cannot be read at all, which callers must treat as unknown
 * rather than as "nothing is on screen".
 */
export function listOnscreenWindows(): readonly OnscreenWindow[] | undefined {
	try {
		return readOnscreenWindows() ?? undefined;
	} catch {
		return undefined;
	}
}

function readOnscreenWindows(): readonly OnscreenWindow[] | null {
	const copyWindowInfo = getWindowListBinding();
	if (copyWindowInfo === null) {
		return null;
	}
	const infos = copyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP_ELEMENTS, NULL_WINDOW_ID);
	if (infos === null) {
		return null;
	}
	try {
		const count = cfArrayLength(infos);
		const windows: OnscreenWindow[] = [];
		for (let index = 0; index < count; index += 1) {
			const info = cfArrayValueAt(infos, index);
			if (info === null) {
				continue;
			}
			const id = readInteger(info, WINDOW_NUMBER_KEY);
			const ownerPid = readInteger(info, WINDOW_OWNER_PID_KEY);
			if (id === undefined || ownerPid === undefined) {
				continue;
			}
			windows.push({ id, ownerPid, layer: readInteger(info, WINDOW_LAYER_KEY) ?? 0 });
		}
		return windows;
	} finally {
		cfRelease(infos);
	}
}

function readInteger(info: CFTypeRef, key: string): number | undefined {
	return withCFString(key, (keyReference) => {
		const value = cfDictionaryValue(info, keyReference);
		if (value === null || !isCFNumber(value)) {
			return undefined;
		}
		return fromCFNumber(value);
	});
}
