import type { KoffiFunc } from "koffi";
import { K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE } from "./coregraphics-types.js";
import { koffi } from "./koffi.js";

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");

// CGEventFlags is a uint64_t bitmask; koffi may hand it back as a number or a bigint.
const CGEventSourceFlagsState = coreGraphics.func("CGEventSourceFlagsState", "uint64_t", ["uint32_t"]) as KoffiFunc<
	(stateId: number) => number | bigint
>;

const CGEventSourceSecondsSinceLastEventType = coreGraphics.func("CGEventSourceSecondsSinceLastEventType", "double", [
	"uint32_t",
	"uint32_t",
]) as KoffiFunc<(stateId: number, eventType: number) => number>;

/** CGEventType values for the physical input kinds {@link readSecondsSinceHidEvent} is asked about. */
export const K_CG_EVENT_LEFT_MOUSE_DOWN = 1;
export const K_CG_EVENT_RIGHT_MOUSE_DOWN = 3;
export const K_CG_EVENT_OTHER_MOUSE_DOWN = 25;

/** Modifier flags of the physical keyboard (HID system state), as a CGEventFlags bitmask. */
export function readHidModifierFlags(): number {
	return Number(CGEventSourceFlagsState(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE));
}

/**
 * Seconds since the last physical event of `eventType` (a CGEventType) reached the HID system. This is
 * the state of the real keyboard and mouse: events posted to a single process do not move it.
 */
export function readSecondsSinceHidEvent(eventType: number): number {
	return CGEventSourceSecondsSinceLastEventType(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE, eventType);
}
