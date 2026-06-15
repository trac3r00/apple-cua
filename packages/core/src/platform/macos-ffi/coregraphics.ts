import { createNSEventBackedMouseEvent } from "./appkit.js";
import { cfRelease } from "./corefoundation.js";
import {
	createCursorEvent,
	createKeyboardEvent,
	createMouseEvent,
	createScrollEvent,
	getLocation,
	postToHidEventTap,
	setFlags,
	setIntegerValueField,
	setLocation,
	setUnicodeString,
	stampEvent,
	warpCursorPosition as warpCursorPositionBinding,
} from "./coregraphics-bindings.js";
import {
	type CGEventRef,
	type CGPoint,
	K_CG_MOUSE_EVENT_BUTTON_NUMBER,
	K_CG_MOUSE_EVENT_CLICK_STATE,
	K_CG_MOUSE_EVENT_SUBTYPE,
	K_CG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER,
	K_CG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER_THAT_CAN_HANDLE_THIS_EVENT,
	type KeyboardEventOptions,
	type MouseButton,
	type MouseEventKind,
	type MouseEventOptions,
	type ScrollEventOptions,
	mouseButtonNumber,
	mouseEventType,
} from "./coregraphics-types.js";
import {
	type SkyLightTargetWindow,
	postAuthenticatedSkyLightEventToPid,
	postCoreGraphicsEventToWindowOwner,
	postSkyLightEventToPid,
	setSkyLightIntegerField,
	setSkyLightWindowLocation,
} from "./skylight.js";

export type {
	CGEventRef,
	CGEventSourceRef,
	CGPoint,
	KeyboardEventOptions,
	MouseButton,
	MouseEventKind,
	MouseEventOptions,
	ScrollEventOptions,
} from "./coregraphics-types.js";
export {
	K_CG_EVENT_FLAG_MASK_ALTERNATE,
	K_CG_EVENT_FLAG_MASK_COMMAND,
	K_CG_EVENT_FLAG_MASK_CONTROL,
	K_CG_EVENT_FLAG_MASK_SHIFT,
	K_CG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE,
	K_CG_HID_EVENT_TAP,
	K_CG_MOUSE_EVENT_BUTTON_NUMBER,
	K_CG_MOUSE_EVENT_CLICK_STATE,
	K_CG_MOUSE_EVENT_SUBTYPE,
	K_CG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER,
	K_CG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER_THAT_CAN_HANDLE_THIS_EVENT,
	K_CG_SCROLL_EVENT_UNIT_LINE,
} from "./coregraphics-types.js";
export { currentUptimeNanoseconds } from "./coregraphics-bindings.js";

export function postMouseEvent(options: MouseEventOptions): void {
	const event = makeMouseEvent(options.kind, options.position, options.button, options.targetWindow);
	try {
		setIntegerValueField(event, K_CG_MOUSE_EVENT_BUTTON_NUMBER, mouseButtonNumber(options.button));
		if (options.clickState !== undefined) {
			setIntegerValueField(event, K_CG_MOUSE_EVENT_CLICK_STATE, options.clickState);
		}
		if (options.targetPid === undefined) {
			postMouse(event, undefined, options.targetWindow);
			return;
		}
		stampTargetedMouseEvent(event, options.targetPid, options.position, options.targetWindow);
		postMouse(event, options.targetPid, options.targetWindow);
	} finally {
		cfRelease(event);
	}
}

export function postKeyboardEvent(options: KeyboardEventOptions): void {
	const event = createKeyboardEvent(options.keyCode, options.keyDown);
	try {
		setFlags(event, options.flags);
		if (options.text !== undefined) {
			setUnicodeString(event, options.text);
		}
		postKeyboard(event, options.targetPid, options.targetWindow);
	} finally {
		cfRelease(event);
	}
}

export function postUnicodeText(
	text: string,
	targetPid: number | undefined,
	targetWindow?: SkyLightTargetWindow | undefined,
): void {
	for (const segment of Array.from(text)) {
		postKeyboardEvent({ keyCode: 0, keyDown: true, flags: 0, text: segment, targetPid, targetWindow });
		postKeyboardEvent({ keyCode: 0, keyDown: false, flags: 0, text: segment, targetPid, targetWindow });
	}
}

export function postScrollEvent(options: ScrollEventOptions): void {
	const event = createScrollEvent(options.deltaX, options.deltaY);
	try {
		postScroll(event, options.targetPid, options.targetWindow);
	} finally {
		cfRelease(event);
	}
}

export function getCurrentCursorPosition(): CGPoint {
	const event = createCursorEvent();
	try {
		return getLocation(event);
	} finally {
		cfRelease(event);
	}
}

export function warpCursorPosition(position: CGPoint): void {
	warpCursorPositionBinding(position);
}

function makeMouseEvent(
	kind: MouseEventKind,
	position: CGPoint,
	button: MouseButton,
	targetWindow: SkyLightTargetWindow | undefined,
): CGEventRef {
	const event =
		targetWindow === undefined
			? createMouseEvent(mouseEventType(kind, button), position, mouseButtonNumber(button))
			: createNSEventBackedMouseEvent(
					mouseEventType(kind, button),
					position,
					0,
					targetWindow.id,
					kind === "move" ? 0 : 1,
				);
	setLocation(event, position);
	stampEvent(event);
	return event;
}

function postMouse(
	event: CGEventRef,
	targetPid: number | undefined,
	targetWindow: SkyLightTargetWindow | undefined,
): void {
	if (targetPid === undefined) {
		postToHidEventTap(event);
		return;
	}
	if (targetWindow === undefined) {
		throw new Error("targeted mouse input requires a target window from get_app_state or a visible app window");
	}
	postSkyLightEventToPid(targetPid, event);
}

function postKeyboard(
	event: CGEventRef,
	targetPid: number | undefined,
	targetWindow: SkyLightTargetWindow | undefined,
): void {
	if (targetPid === undefined) {
		postToHidEventTap(event);
		return;
	}
	if (targetWindow === undefined) {
		throw new Error("targeted keyboard input requires a target window from get_app_state or a prior pointer action");
	}
	if (!postAuthenticatedSkyLightEventToPid(targetPid, event)) {
		throw new Error("failed to build authenticated targeted keyboard event");
	}
	postCoreGraphicsEventToWindowOwner(targetWindow, event);
}

function postScroll(
	event: CGEventRef,
	targetPid: number | undefined,
	targetWindow: SkyLightTargetWindow | undefined,
): void {
	if (targetPid === undefined) {
		postToHidEventTap(event);
		return;
	}
	if (targetWindow === undefined) {
		throw new Error("targeted scroll input requires a target window from get_app_state or a prior pointer action");
	}
	postSkyLightEventToPid(targetPid, event);
	postCoreGraphicsEventToWindowOwner(targetWindow, event);
}

function stampTargetedMouseEvent(
	event: CGEventRef,
	targetPid: number,
	position: CGPoint,
	targetWindow: SkyLightTargetWindow | undefined,
): void {
	setIntegerValueField(event, K_CG_MOUSE_EVENT_SUBTYPE, 3);
	if (targetWindow !== undefined) {
		setIntegerValueField(event, K_CG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER, targetWindow.id);
		setIntegerValueField(
			event,
			K_CG_MOUSE_EVENT_WINDOW_UNDER_MOUSE_POINTER_THAT_CAN_HANDLE_THIS_EVENT,
			targetWindow.id,
		);
		setSkyLightWindowLocation(event, {
			x: position.x - targetWindow.bounds.x,
			y: position.y - targetWindow.bounds.y,
		});
	} else {
		setSkyLightWindowLocation(event, position);
	}
	setSkyLightIntegerField(event, 40, targetPid);
}
