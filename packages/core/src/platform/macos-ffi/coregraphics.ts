import type { KoffiFunc } from "koffi";
import { type CFTypeRef, cfRelease } from "./corefoundation.js";
import { koffi } from "./koffi.js";

export type CGEventRef = CFTypeRef;
export type CGEventSourceRef = CFTypeRef;

export type CGPoint = {
	x: number;
	y: number;
};

export type MouseButton = "left" | "right" | "middle";
export type MouseEventKind = "move" | "down" | "up" | "drag";

export type MouseEventOptions = {
	readonly kind: MouseEventKind;
	readonly position: CGPoint;
	readonly button: MouseButton;
	readonly clickState: number | undefined;
	readonly targetPid: number | undefined;
};

export type KeyboardEventOptions = {
	readonly keyCode: number;
	readonly keyDown: boolean;
	readonly flags: number;
	readonly text: string | undefined;
	readonly targetPid: number | undefined;
};

export type ScrollEventOptions = {
	readonly deltaX: number;
	readonly deltaY: number;
	readonly targetPid: number | undefined;
};

export const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE = 1;
export const K_CG_HID_EVENT_TAP = 0;
export const K_CG_SCROLL_EVENT_UNIT_LINE = 1;
export const K_CG_MOUSE_EVENT_CLICK_STATE = 1;
export const K_CG_MOUSE_EVENT_BUTTON_NUMBER = 3;
export const K_CG_EVENT_FLAG_MASK_SHIFT = 0x00020000;
export const K_CG_EVENT_FLAG_MASK_CONTROL = 0x00040000;
export const K_CG_EVENT_FLAG_MASK_ALTERNATE = 0x00080000;
export const K_CG_EVENT_FLAG_MASK_COMMAND = 0x00100000;

const CLOCK_UPTIME_RAW = 8;

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const systemLibrary = koffi.load(null);
const CG_POINT = koffi.struct("CGPoint", { x: "double", y: "double" });
const CG_EVENT_REF = koffi.pointer("CGEventRef", koffi.opaque());
const CG_EVENT_SOURCE_REF = koffi.pointer("CGEventSourceRef", koffi.opaque());

const CGEventSourceCreate = coreGraphics.func("CGEventSourceCreate", CG_EVENT_SOURCE_REF, ["uint32_t"]) as KoffiFunc<
	(stateId: number) => CGEventSourceRef | null
>;

const CGEventCreate = coreGraphics.func("CGEventCreate", CG_EVENT_REF, [CG_EVENT_SOURCE_REF]) as KoffiFunc<
	(source: CGEventSourceRef | null) => CGEventRef | null
>;

const CGEventCreateMouseEvent = coreGraphics.func("CGEventCreateMouseEvent", CG_EVENT_REF, [
	CG_EVENT_SOURCE_REF,
	"uint32_t",
	CG_POINT,
	"uint32_t",
]) as KoffiFunc<(source: CGEventSourceRef, eventType: number, position: CGPoint, button: number) => CGEventRef | null>;

const CGEventCreateKeyboardEvent = coreGraphics.func("CGEventCreateKeyboardEvent", CG_EVENT_REF, [
	CG_EVENT_SOURCE_REF,
	"uint16_t",
	"bool",
]) as KoffiFunc<(source: CGEventSourceRef, keyCode: number, keyDown: boolean) => CGEventRef | null>;

const CGEventCreateScrollWheelEvent = coreGraphics.func("CGEventCreateScrollWheelEvent", CG_EVENT_REF, [
	CG_EVENT_SOURCE_REF,
	"uint32_t",
	"uint32_t",
	"int32_t",
	"int32_t",
]) as KoffiFunc<
	(source: CGEventSourceRef, units: number, wheelCount: number, wheel1: number, wheel2: number) => CGEventRef | null
>;

const CGEventKeyboardSetUnicodeString = coreGraphics.func("CGEventKeyboardSetUnicodeString", "void", [
	CG_EVENT_REF,
	"uint64_t",
	"string16",
]) as KoffiFunc<(event: CGEventRef, stringLength: number, text: string) => void>;

const CGEventSetFlags = coreGraphics.func("CGEventSetFlags", "void", [CG_EVENT_REF, "uint64_t"]) as KoffiFunc<
	(event: CGEventRef, flags: number) => void
>;

const CGEventSetIntegerValueField = coreGraphics.func("CGEventSetIntegerValueField", "void", [
	CG_EVENT_REF,
	"uint32_t",
	"int64_t",
]) as KoffiFunc<(event: CGEventRef, field: number, value: number) => void>;

const CGEventSetTimestamp = coreGraphics.func("CGEventSetTimestamp", "void", [CG_EVENT_REF, "uint64_t"]) as KoffiFunc<
	(event: CGEventRef, timestamp: bigint) => void
>;

const CGEventGetLocation = coreGraphics.func("CGEventGetLocation", CG_POINT, [CG_EVENT_REF]) as KoffiFunc<
	(event: CGEventRef) => CGPoint
>;

const CGEventPost = coreGraphics.func("CGEventPost", "void", ["uint32_t", CG_EVENT_REF]) as KoffiFunc<
	(tap: number, event: CGEventRef) => void
>;

const CGEventPostToPid = coreGraphics.func("CGEventPostToPid", "void", ["int32_t", CG_EVENT_REF]) as KoffiFunc<
	(pid: number, event: CGEventRef) => void
>;

const clockGetTimeNanoseconds = systemLibrary.func("clock_gettime_nsec_np", "uint64_t", ["int"]) as KoffiFunc<
	(clockId: number) => bigint
>;

export function currentUptimeNanoseconds(): bigint {
	return clockGetTimeNanoseconds(CLOCK_UPTIME_RAW);
}

export function postMouseEvent(options: MouseEventOptions): void {
	const event = createMouseEvent(options.kind, options.position, options.button);
	try {
		CGEventSetIntegerValueField(event, K_CG_MOUSE_EVENT_BUTTON_NUMBER, mouseButtonNumber(options.button));
		if (options.clickState !== undefined) {
			CGEventSetIntegerValueField(event, K_CG_MOUSE_EVENT_CLICK_STATE, options.clickState);
		}
		postEvent(event, options.targetPid);
	} finally {
		cfRelease(event);
	}
}

export function postKeyboardEvent(options: KeyboardEventOptions): void {
	const event = createKeyboardEvent(options.keyCode, options.keyDown);
	try {
		CGEventSetFlags(event, options.flags);
		if (options.text !== undefined) {
			CGEventKeyboardSetUnicodeString(event, options.text.length, options.text);
		}
		postEvent(event, options.targetPid);
	} finally {
		cfRelease(event);
	}
}

export function postUnicodeText(text: string, targetPid: number | undefined): void {
	for (const segment of Array.from(text)) {
		postKeyboardEvent({ keyCode: 0, keyDown: true, flags: 0, text: segment, targetPid });
		postKeyboardEvent({ keyCode: 0, keyDown: false, flags: 0, text: segment, targetPid });
	}
}

export function postScrollEvent(options: ScrollEventOptions): void {
	const event = createScrollEvent(options.deltaX, options.deltaY);
	try {
		postEvent(event, options.targetPid);
	} finally {
		cfRelease(event);
	}
}

export function getCurrentCursorPosition(): CGPoint {
	const event = CGEventCreate(null);
	if (event === null) {
		throw new Error("CGEventCreate returned null");
	}

	try {
		return CGEventGetLocation(event);
	} finally {
		cfRelease(event);
	}
}

function createEventSource(): CGEventSourceRef {
	const source = CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE);
	if (source === null) {
		throw new Error("CGEventSourceCreate returned null");
	}
	return source;
}

function createMouseEvent(kind: MouseEventKind, position: CGPoint, button: MouseButton): CGEventRef {
	const source = createEventSource();
	try {
		const event = CGEventCreateMouseEvent(source, mouseEventType(kind, button), position, mouseButtonNumber(button));
		if (event === null) {
			throw new Error("CGEventCreateMouseEvent returned null");
		}
		stampEvent(event);
		return event;
	} finally {
		cfRelease(source);
	}
}

function createKeyboardEvent(keyCode: number, keyDown: boolean): CGEventRef {
	const source = createEventSource();
	try {
		const event = CGEventCreateKeyboardEvent(source, keyCode, keyDown);
		if (event === null) {
			throw new Error("CGEventCreateKeyboardEvent returned null");
		}
		stampEvent(event);
		return event;
	} finally {
		cfRelease(source);
	}
}

function createScrollEvent(deltaX: number, deltaY: number): CGEventRef {
	const source = createEventSource();
	try {
		const event = CGEventCreateScrollWheelEvent(source, K_CG_SCROLL_EVENT_UNIT_LINE, 2, deltaY, deltaX);
		if (event === null) {
			throw new Error("CGEventCreateScrollWheelEvent returned null");
		}
		stampEvent(event);
		return event;
	} finally {
		cfRelease(source);
	}
}

function stampEvent(event: CGEventRef): void {
	CGEventSetTimestamp(event, currentUptimeNanoseconds());
}

function postEvent(event: CGEventRef, targetPid: number | undefined): void {
	if (targetPid === undefined) {
		CGEventPost(K_CG_HID_EVENT_TAP, event);
		return;
	}

	CGEventPostToPid(targetPid, event);
}

function mouseButtonNumber(button: MouseButton): number {
	switch (button) {
		case "left":
			return 0;
		case "right":
			return 1;
		case "middle":
			return 2;
	}
}

function mouseEventType(kind: MouseEventKind, button: MouseButton): number {
	if (kind === "move") {
		return 5;
	}

	if (button === "left") {
		switch (kind) {
			case "down":
				return 1;
			case "up":
				return 2;
			case "drag":
				return 6;
		}
	}

	if (button === "right") {
		switch (kind) {
			case "down":
				return 3;
			case "up":
				return 4;
			case "drag":
				return 7;
		}
	}

	switch (kind) {
		case "down":
			return 25;
		case "up":
			return 26;
		case "drag":
			return 27;
	}
}
