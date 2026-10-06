import type { KoffiFunc } from "koffi";
import type { CGEventRef, CGPoint } from "./coregraphics-types.js";
import { koffi } from "./koffi.js";

export interface SkyLightTargetWindow {
	readonly id: number;
	readonly bounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
}

export interface FocusRestoreToken {
	readonly previousPsn: Buffer;
	/** Process serial number the lease focused, so the holder can tell whether it still holds focus. */
	readonly targetPsn: Buffer;
}

const skyLight = koffi.load("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight");
const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const objc = koffi.load("/usr/lib/libobjc.A.dylib");
const CG_POINT = koffi.struct("SLCGPoint", { x: "double", y: "double" });

const SLEventPostToPid = skyLight.func("SLEventPostToPid", "void", ["int32_t", "void *"]) as KoffiFunc<
	(pid: number, event: CGEventRef) => void
>;

const SLEventSetAuthenticationMessage = skyLight.func("SLEventSetAuthenticationMessage", "void", [
	"void *",
	"void *",
]) as KoffiFunc<(event: CGEventRef, message: object) => void>;

const SLEventSetIntegerValueField = skyLight.func("SLEventSetIntegerValueField", "void", [
	"void *",
	"uint32_t",
	"int64_t",
]) as KoffiFunc<(event: CGEventRef, field: number, value: number) => void>;

const CGEventSetWindowLocation = skyLight.func("CGEventSetWindowLocation", "void", ["void *", CG_POINT]) as KoffiFunc<
	(event: CGEventRef, point: CGPoint) => void
>;

const CGSMainConnectionID = skyLight.func("CGSMainConnectionID", "uint32_t", []) as KoffiFunc<() => number>;

const SLPSPostEventRecordTo = skyLight.func("SLPSPostEventRecordTo", "int32_t", ["void *", "void *"]) as KoffiFunc<
	(psn: Buffer, eventRecord: Buffer) => number
>;

const _SLPSGetFrontProcess = skyLight.func("_SLPSGetFrontProcess", "int32_t", ["void *"]) as KoffiFunc<
	(psn: Buffer) => number
>;

const SLPSSetFrontProcessWithOptions = skyLight.func("SLPSSetFrontProcessWithOptions", "int32_t", [
	"void *",
	"uint32_t",
	"uint32_t",
]) as KoffiFunc<(psn: Buffer, windowId: number, options: number) => number>;

const SLSGetWindowOwner = skyLight.func("SLSGetWindowOwner", "int32_t", [
	"uint32_t",
	"uint32_t",
	"_Out_ uint32_t *",
]) as KoffiFunc<(connection: number, windowId: number, ownerConnection: number[]) => number>;

const SLSGetConnectionPSN = skyLight.func("SLSGetConnectionPSN", "int32_t", ["uint32_t", "void *"]) as KoffiFunc<
	(connection: number, psn: Buffer) => number
>;

const CGEventPostToPSN = coreGraphics.func("CGEventPostToPSN", "void", ["void *", "void *"]) as KoffiFunc<
	(psn: Buffer, event: CGEventRef) => void
>;

const objcGetClass = objc.func("objc_getClass", "void *", ["str"]) as KoffiFunc<(name: string) => object | null>;
const selRegisterName = objc.func("sel_registerName", "void *", ["str"]) as KoffiFunc<(name: string) => object | null>;
const classGetClassMethod = objc.func("class_getClassMethod", "void *", ["void *", "void *"]) as KoffiFunc<
	(cls: object, selector: object) => object | null
>;
const objcMsgSendAuthenticationMessage = objc.func("objc_msgSend", "void *", [
	"void *",
	"void *",
	"void *",
	"int32_t",
	"uint32_t",
]) as KoffiFunc<
	(receiver: object, selector: object, eventRecord: object, pid: number, version: number) => object | null
>;

const authenticationMessageClass = objcGetClass("SLSEventAuthenticationMessage");
const authenticationMessageSelector = selRegisterName("messageWithEventRecord:pid:version:");
/**
 * macOS 14 ships SLSEventAuthenticationMessage without +messageWithEventRecord:pid:version: (it arrived in macOS
 * 15), and sending a class a selector it does not implement raises an Objective-C exception that aborts the whole
 * process. Asked once up front, so there authenticated delivery reports itself unavailable and keyboard input takes
 * the window owner's CoreGraphics path instead.
 */
const authenticationMessageAvailable =
	authenticationMessageClass !== null &&
	authenticationMessageSelector !== null &&
	classGetClassMethod(authenticationMessageClass, authenticationMessageSelector) !== null;
const K_CPS_NO_WINDOWS = 0x400;
const K_CPS_USER_GENERATED = 0x200;

/** CGS event types, which share CGEventType's numbering for the mouse events we synthesize. */
export const CGS_EVENT_LEFT_MOUSE_DOWN = 1;
export const CGS_EVENT_LEFT_MOUSE_UP = 2;
export const CGS_EVENT_LEFT_MOUSE_DRAGGED = 6;

const EVENT_RECORD_LENGTH = 0xf8;
const RECORD_LENGTH_OFFSET = 0x04;
const RECORD_TYPE_OFFSET = 0x08;
const RECORD_LOCATION_OFFSET = 0x10;
const RECORD_WINDOW_LOCATION_OFFSET = 0x20;
const RECORD_FLAG_OFFSET = 0x3a;
const RECORD_WINDOW_ID_OFFSET = 0x3c;
const RECORD_FLAG_VALUE = 0x10;

/**
 * One synthesized mouse event as the window server reads it: a fixed-length record addressed to
 * a window, with the pointer located globally and in window coordinates. Written by hand because
 * the layout is the documented yabai one; every field stays inside the buffer, so a wrong value
 * is a no-op rather than a crash. Exported for its own unit test — the layout is the contract.
 */
export function buildMouseEventRecord(window: SkyLightTargetWindow, eventType: number, location: CGPoint): Buffer {
	const record = Buffer.alloc(EVENT_RECORD_LENGTH);
	record[RECORD_LENGTH_OFFSET] = EVENT_RECORD_LENGTH;
	record[RECORD_FLAG_OFFSET] = RECORD_FLAG_VALUE;
	record[RECORD_TYPE_OFFSET] = eventType;
	record.writeUInt32LE(window.id, RECORD_WINDOW_ID_OFFSET);
	record.writeDoubleLE(location.x, RECORD_LOCATION_OFFSET);
	record.writeDoubleLE(location.y, RECORD_LOCATION_OFFSET + 8);
	record.writeDoubleLE(location.x - window.bounds.x, RECORD_WINDOW_LOCATION_OFFSET);
	record.writeDoubleLE(location.y - window.bounds.y, RECORD_WINDOW_LOCATION_OFFSET + 8);
	return record;
}

/**
 * Deliver one synthesized mouse event straight to a window's own process.
 *
 * This is the path that reaches an unfocused window: a CGEvent posted at global coordinates goes
 * to whatever is frontmost, and posting one to a pid does not deliver mouse events at all. The
 * window server, however, accepts a synthesized record addressed to the process and window, which
 * is how a tap or a drag lands in a window the user never brought forward.
 */
export function postMouseEventRecordToWindow(
	window: SkyLightTargetWindow,
	eventType: number,
	location: CGPoint,
): boolean {
	const targetPsn = processSerialNumberForWindow(window.id);
	if (targetPsn === null) {
		return false;
	}
	SLPSSetFrontProcessWithOptions(targetPsn, window.id, K_CPS_USER_GENERATED);
	return SLPSPostEventRecordTo(targetPsn, buildMouseEventRecord(window, eventType, location)) === 0;
}

export function postSkyLightEventToPid(pid: number, event: CGEventRef): void {
	SLEventPostToPid(pid, event);
}

export function postAuthenticatedSkyLightEventToPid(pid: number, event: CGEventRef): boolean {
	const message = authenticationMessage(pid, event);
	if (message === null) {
		return false;
	}
	SLEventSetAuthenticationMessage(event, message);
	SLEventPostToPid(pid, event);
	return true;
}

export function setSkyLightIntegerField(event: CGEventRef, field: number, value: number): void {
	SLEventSetIntegerValueField(event, field, value);
}

export function setSkyLightWindowLocation(event: CGEventRef, point: CGPoint): void {
	CGEventSetWindowLocation(event, point);
}

export function activateWindowWithoutRaise(window: SkyLightTargetWindow): boolean {
	const previousPsn = Buffer.alloc(8);
	if (_SLPSGetFrontProcess(previousPsn) !== 0) {
		return false;
	}

	const targetPsn = processSerialNumberForWindow(window.id);
	if (targetPsn === null) {
		return false;
	}

	const record = Buffer.alloc(0xf8);
	record[0x04] = 0xf8;
	record[0x08] = 0x0d;
	record.writeUInt32LE(window.id, 0x3c);

	record[0x8a] = 0x02;
	const defocused = SLPSPostEventRecordTo(previousPsn, record) === 0;
	record[0x8a] = 0x01;
	const focused = SLPSPostEventRecordTo(targetPsn, record) === 0;
	return defocused && focused;
}

/**
 * Tell a process (resolved earlier, as focusGuardFor's `targetPsn`) that it is, or no longer is, the
 * active app, without changing the front process, raising anything, or telling the person's app
 * anything. Activating names `windowId`, which the app makes its key window. An app that believes it
 * is active stops swallowing the first click of a gesture, reads modifier flags off a click, and
 * enables its window commands (Save, New Folder) like it does for a person; the frontmost app stays
 * whoever the person is using. Addressed by process rather than by window, so an app can still be told
 * it is inactive after the window it was activated with has closed.
 */
export function setProcessAppActive(psn: Buffer, windowId: number, active: boolean): boolean {
	const record = Buffer.alloc(0xf8);
	record[0x04] = 0xf8;
	record[0x08] = 0x0d;
	record.writeUInt32LE(windowId, 0x3c);
	record[0x8a] = active ? 0x01 : 0x02;
	return SLPSPostEventRecordTo(psn, record) === 0;
}

export function beginFocusWithoutRaise(window: SkyLightTargetWindow): FocusRestoreToken | null {
	const previousPsn = frontProcessSerialNumber();
	if (previousPsn === null) {
		return null;
	}

	const targetPsn = processSerialNumberForWindow(window.id);
	if (targetPsn === null) {
		return null;
	}

	const record = Buffer.alloc(0xf8);
	record[0x04] = 0xf8;
	record[0x08] = 0x0d;
	record.writeUInt32LE(window.id, 0x3c);
	record[0x8a] = 0x02;
	const defocused = SLPSPostEventRecordTo(previousPsn, record) === 0;
	record[0x8a] = 0x01;
	const focused = SLPSPostEventRecordTo(targetPsn, record) === 0;
	return defocused && focused ? { previousPsn, targetPsn } : null;
}

/** The process that is frontmost right now, or null when the query fails. */
export function frontProcessSerialNumber(): Buffer | null {
	const frontProcess = Buffer.alloc(8);
	return _SLPSGetFrontProcess(frontProcess) === 0 ? frontProcess : null;
}

/**
 * Who is frontmost before background input reaches `window`, so a target app that activates itself
 * in response (Finder's Go to Folder panel does) can be sent back behind the person's app. Null
 * when the target already is frontmost or either process cannot be resolved.
 */
export function focusGuardFor(window: SkyLightTargetWindow): FocusRestoreToken | null {
	const previousPsn = frontProcessSerialNumber();
	const targetPsn = processSerialNumberForWindow(window.id);
	if (previousPsn === null || targetPsn === null || previousPsn.equals(targetPsn)) {
		return null;
	}
	return { previousPsn, targetPsn };
}

export function processSerialNumbersMatch(left: Buffer, right: Buffer): boolean {
	return left.equals(right);
}

export function restoreFrontProcessNoWindows(token: FocusRestoreToken): boolean {
	return SLPSSetFrontProcessWithOptions(token.previousPsn, 0, K_CPS_NO_WINDOWS) === 0;
}

export function postCoreGraphicsEventToWindowOwner(window: SkyLightTargetWindow, event: CGEventRef): boolean {
	const targetPsn = processSerialNumberForWindow(window.id);
	if (targetPsn === null) {
		return false;
	}
	CGEventPostToPSN(targetPsn, event);
	return true;
}

function processSerialNumberForWindow(windowId: number): Buffer | null {
	const ownerConnection = [0];
	if (SLSGetWindowOwner(CGSMainConnectionID(), windowId, ownerConnection) !== 0) {
		return null;
	}
	const [connection] = ownerConnection;
	if (connection === undefined) {
		return null;
	}

	const targetPsn = Buffer.alloc(8);
	return SLSGetConnectionPSN(connection, targetPsn) === 0 ? targetPsn : null;
}

function authenticationMessage(pid: number, event: CGEventRef): object | null {
	if (
		!authenticationMessageAvailable ||
		authenticationMessageClass === null ||
		authenticationMessageSelector === null
	) {
		return null;
	}
	const record = eventRecord(event);
	if (record === null) {
		return null;
	}
	return objcMsgSendAuthenticationMessage(authenticationMessageClass, authenticationMessageSelector, record, pid, 0);
}

function eventRecord(event: CGEventRef): object | null {
	for (const offset of [24, 32, 16]) {
		const pointer = koffi.decode(event, offset, "void *") as object | null;
		if (pointer !== null) {
			return pointer;
		}
	}
	return null;
}
