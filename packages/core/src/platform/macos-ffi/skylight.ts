import type { KoffiFunc } from "koffi";
import type { CGEventRef, CGPoint } from "./coregraphics.js";
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
	if (authenticationMessageClass === null || authenticationMessageSelector === null) {
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
