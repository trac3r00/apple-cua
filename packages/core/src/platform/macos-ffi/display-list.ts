import type { KoffiFunc } from "koffi";
import type { Rect } from "../../types/index.js";
import { koffi } from "./koffi.js";

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const CG_POINT = koffi.struct("CGPointForDisplayList", { x: "double", y: "double" });
const CG_SIZE = koffi.struct("CGSizeForDisplayList", { width: "double", height: "double" });
const CG_RECT = koffi.struct("CGRectForDisplayList", { origin: CG_POINT, size: CG_SIZE });

const CGGetOnlineDisplayList = coreGraphics.func("CGGetOnlineDisplayList", "int32_t", [
	"uint32_t",
	"void *",
	"void *",
]) as KoffiFunc<(maxDisplays: number, displays: Buffer | null, displayCount: Buffer) => number>;

const CGDisplayBounds = coreGraphics.func("CGDisplayBounds", CG_RECT, ["uint32_t"]) as KoffiFunc<
	(display: number) => {
		readonly origin: { readonly x: number; readonly y: number };
		readonly size: { readonly width: number; readonly height: number };
	}
>;

const DISPLAY_ID_BYTES = 4;

/**
 * The bounds of every online display (awake, asleep or mirrored) in global points with a top-left origin, the
 * coordinates the window list uses. Undefined when the list cannot be read, names no display, or a display appeared
 * while it was read: callers must then treat the layout as unknown.
 */
export function onlineDisplayBounds(): readonly Rect[] | undefined {
	try {
		const count = Buffer.alloc(DISPLAY_ID_BYTES);
		if (CGGetOnlineDisplayList(0, null, count) !== 0) {
			return undefined;
		}
		// One slot more than reported: a list that fills it grew in between, and could have grown further.
		const capacity = count.readUInt32LE(0) + 1;
		const ids = Buffer.alloc(capacity * DISPLAY_ID_BYTES);
		if (CGGetOnlineDisplayList(capacity, ids, count) !== 0) {
			return undefined;
		}
		const found = count.readUInt32LE(0);
		if (found === 0 || found >= capacity) {
			return undefined;
		}
		const displays: Rect[] = [];
		for (let index = 0; index < found; index += 1) {
			const { origin, size } = CGDisplayBounds(ids.readUInt32LE(index * DISPLAY_ID_BYTES));
			displays.push({ x: origin.x, y: origin.y, width: size.width, height: size.height });
		}
		return displays;
	} catch {
		return undefined;
	}
}
