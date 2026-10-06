import { K_CG_EVENT_FLAG_MASK_COMMAND } from "./macos-ffi/coregraphics-types.js";
import {
	K_CG_EVENT_LEFT_MOUSE_DOWN,
	K_CG_EVENT_OTHER_MOUSE_DOWN,
	K_CG_EVENT_RIGHT_MOUSE_DOWN,
	readHidModifierFlags,
	readSecondsSinceHidEvent,
} from "./macos-ffi/event-flags.js";

/** What the physical keyboard and mouse are doing, read from the HID system state. */
export interface PhysicalInputProbe {
	/** Seconds since the last physical mouse button press of any button; Infinity when there was none. */
	readonly secondsSinceMouseDown: () => number;
	/** Whether the physical Command key is down right now. */
	readonly commandHeld: () => boolean;
}

export interface DeliberateSwitchDetector {
	/** Look at the keyboard now; call it on every tick so a short Command press is not missed. */
	readonly sample: () => void;
	/** Whether the person has used the mouse or Command since the detector was created. */
	readonly deliberate: () => boolean;
}

export const hidPhysicalInputProbe: PhysicalInputProbe = {
	secondsSinceMouseDown: () =>
		Math.min(
			sanitizeSeconds(readSecondsSinceHidEvent(K_CG_EVENT_LEFT_MOUSE_DOWN)),
			sanitizeSeconds(readSecondsSinceHidEvent(K_CG_EVENT_RIGHT_MOUSE_DOWN)),
			sanitizeSeconds(readSecondsSinceHidEvent(K_CG_EVENT_OTHER_MOUSE_DOWN)),
		),
	commandHeld: () => (readHidModifierFlags() & K_CG_EVENT_FLAG_MASK_COMMAND) !== 0,
};

function sanitizeSeconds(seconds: number): number {
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : Number.POSITIVE_INFINITY;
}

/**
 * Tells a person's own switch to the target (a click on it or its Dock icon, Command-Tab) from the
 * target taking the front because of our background input. Both look the same in the front-process
 * record; only the physical devices differ. A mouse press or a Command key seen after the detector
 * was created counts. Plain key presses do not: the person typing in their own app while the target
 * steals the front is the very case the watcher exists for. Input from before creation never counts.
 */
export function createDeliberateSwitchDetector(
	probe: PhysicalInputProbe,
	nowMilliseconds: () => number,
): DeliberateSwitchDetector {
	const startedAt = nowMilliseconds();
	let commandSeen = false;
	const sample = (): void => {
		commandSeen ||= probe.commandHeld();
	};
	return {
		sample,
		deliberate: () => {
			sample();
			if (commandSeen) {
				return true;
			}
			const elapsedSeconds = (nowMilliseconds() - startedAt) / 1000;
			return probe.secondsSinceMouseDown() < elapsedSeconds;
		},
	};
}
