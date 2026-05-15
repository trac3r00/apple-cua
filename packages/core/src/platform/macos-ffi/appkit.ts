import type { KoffiFunc } from "koffi";
import { cfRetain } from "./corefoundation.js";
import type { CGEventRef, CGPoint } from "./coregraphics.js";
import { koffi } from "./koffi.js";

const appKit = koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const objc = koffi.load("/usr/lib/libobjc.A.dylib");
const NS_POINT = koffi.struct("NSPointForNSEvent", { x: "double", y: "double" });
const CG_POINT = koffi.struct("CGPointForNSEventScreen", { x: "double", y: "double" });
const CG_SIZE = koffi.struct("CGSizeForNSEventScreen", { width: "double", height: "double" });
const CG_RECT = koffi.struct("CGRectForNSEventScreen", { origin: CG_POINT, size: CG_SIZE });

const objcGetClass = objc.func("objc_getClass", "void *", ["str"]) as KoffiFunc<(name: string) => object | null>;
const selRegisterName = objc.func("sel_registerName", "void *", ["str"]) as KoffiFunc<(name: string) => object | null>;

const objcMsgSendMouseEvent = objc.func("objc_msgSend", "void *", [
	"void *",
	"void *",
	"uint64_t",
	NS_POINT,
	"uint64_t",
	"double",
	"int64_t",
	"void *",
	"int64_t",
	"int64_t",
	"double",
]) as KoffiFunc<
	(
		receiver: object,
		selector: object,
		type: number,
		location: CGPoint,
		modifierFlags: number,
		timestamp: number,
		windowNumber: number,
		context: null,
		eventNumber: number,
		clickCount: number,
		pressure: number,
	) => object | null
>;

const objcMsgSendPointer = objc.func("objc_msgSend", "void *", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => CGEventRef | null
>;
const objcMsgSendBoolInteger = objc.func("objc_msgSend", "bool", ["void *", "void *", "int64_t"]) as KoffiFunc<
	(receiver: object, selector: object, value: number) => boolean
>;

const CGMainDisplayID = coreGraphics.func("CGMainDisplayID", "uint32_t", []) as KoffiFunc<() => number>;
const CGDisplayBounds = coreGraphics.func("CGDisplayBounds", CG_RECT, ["uint32_t"]) as KoffiFunc<
	(displayId: number) => { origin: CGPoint; size: { width: number; height: number } }
>;

const processInfoClass = requireClass("NSProcessInfo");
const processInfoSelector = requireSelector("processInfo");
const systemUptimeSelector = requireSelector("systemUptime");
const objcMsgSendDouble = objc.func("objc_msgSend", "double", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => number
>;

const nsApplicationClass = requireClass("NSApplication");
const nsEventClass = requireClass("NSEvent");
const sharedApplicationSelector = requireSelector("sharedApplication");
const setActivationPolicySelector = requireSelector("setActivationPolicy:");
const mouseEventSelector = requireSelector(
	"mouseEventWithType:location:modifierFlags:timestamp:windowNumber:context:eventNumber:clickCount:pressure:",
);
const cgEventSelector = requireSelector("CGEvent");
const cgEventFallbackSelector = requireSelector("cgEvent");

void appKit;

export function createNSEventBackedMouseEvent(
	type: number,
	location: CGPoint,
	modifierFlags: number,
	windowNumber: number,
	clickCount: number,
): CGEventRef {
	ensureSharedApplication();
	const event = objcMsgSendMouseEvent(
		nsEventClass,
		mouseEventSelector,
		type,
		cocoaPoint(location),
		modifierFlags,
		systemUptime(),
		windowNumber,
		null,
		0,
		clickCount,
		1,
	);
	if (event === null) {
		throw new Error(`NSEvent.mouseEvent returned null for event type ${type}`);
	}

	const cgEvent = objcMsgSendPointer(event, cgEventSelector) ?? objcMsgSendPointer(event, cgEventFallbackSelector);
	if (cgEvent === null) {
		throw new Error(`NSEvent.cgEvent returned null for event type ${type}`);
	}
	return cfRetain(cgEvent);
}

function ensureSharedApplication(): void {
	const app = objcMsgSendPointer(nsApplicationClass, sharedApplicationSelector);
	if (app !== null) {
		// NSApplicationActivationPolicy.accessory keeps the process out of the Dock while creating NSEvents.
		objcMsgSendBoolInteger(app, setActivationPolicySelector, 1);
	}
}

function cocoaPoint(screenPoint: CGPoint): CGPoint {
	return { x: screenPoint.x, y: mainScreenHeight() - screenPoint.y };
}

function mainScreenHeight(): number {
	return CGDisplayBounds(CGMainDisplayID()).size.height;
}

function systemUptime(): number {
	const processInfo = objcMsgSendPointer(processInfoClass, processInfoSelector);
	if (processInfo === null) {
		return 0;
	}
	return objcMsgSendDouble(processInfo, systemUptimeSelector);
}

function requireClass(name: string): object {
	const klass = objcGetClass(name);
	if (klass === null) {
		throw new Error(`Objective-C class not found: ${name}`);
	}
	return klass;
}

function requireSelector(name: string): object {
	const selector = selRegisterName(name);
	if (selector === null) {
		throw new Error(`Objective-C selector not found: ${name}`);
	}
	return selector;
}
