import type { KoffiFunc } from "koffi";
import { K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE } from "./coregraphics-types.js";
import { koffi } from "./koffi.js";

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");

// CGEventFlags is a uint64_t bitmask; koffi may hand it back as a number or a bigint.
const CGEventSourceFlagsState = coreGraphics.func("CGEventSourceFlagsState", "uint64_t", ["uint32_t"]) as KoffiFunc<
	(stateId: number) => number | bigint
>;

/** Modifier flags of the physical keyboard (HID system state), as a CGEventFlags bitmask. */
export function readHidModifierFlags(): number {
	return Number(CGEventSourceFlagsState(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE));
}
