import type { KoffiFunc } from "koffi";
import { type CFTypeRef, cfBooleanTrue, cfRelease } from "./corefoundation.js";
import { koffi } from "./koffi.js";

// The calls that put macOS's own permission dialogs on screen for this process, and the one read-only check the
// preflight functions elsewhere do not cover (Automation). Run inside the signed helper, the dialogs and the System
// Settings entries they create name "apple-cua-mcp" instead of the terminal that started setup.

const coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const applicationServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const coreServices = koffi.load("/System/Library/Frameworks/CoreServices.framework/CoreServices");

const CGRequestScreenCaptureAccess = coreGraphics.func("CGRequestScreenCaptureAccess", "bool", []) as KoffiFunc<
	() => boolean
>;

const AXIsProcessTrustedWithOptions = applicationServices.func("AXIsProcessTrustedWithOptions", "bool", [
	"void *",
]) as KoffiFunc<(options: CFTypeRef) => boolean>;

const CFDictionaryCreate = coreFoundation.func("CFDictionaryCreate", "void *", [
	"void *",
	"void **",
	"void **",
	"long",
	"void *",
	"void *",
]) as KoffiFunc<
	(
		allocator: null,
		keys: readonly CFTypeRef[],
		values: readonly CFTypeRef[],
		count: number,
		keyCallbacks: unknown,
		valueCallbacks: unknown,
	) => CFTypeRef | null
>;

// AEDesc is { DescType descriptorType; AEDataStorage dataHandle; }: 16 bytes on 64-bit macOS, filled by AECreateDesc.
const AE_DESC_SIZE = 16;
const TYPE_APPLICATION_BUNDLE_ID = 0x62756e64; // 'bund'
const TYPE_WILD_CARD = 0x2a2a2a2a; // '****'
const NO_ERR = 0;
const ERR_AE_EVENT_NOT_PERMITTED = -1743;
const ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT = -1744;
const PROC_NOT_FOUND = -600;

const AECreateDesc = coreServices.func("AECreateDesc", "int16", ["uint32", "void *", "long", "void *"]) as KoffiFunc<
	(typeCode: number, data: Buffer, size: number, result: Buffer) => number
>;
const AEDisposeDesc = coreServices.func("AEDisposeDesc", "int16", ["void *"]) as KoffiFunc<(desc: Buffer) => number>;
const AEDeterminePermissionToAutomateTarget = coreServices.func("AEDeterminePermissionToAutomateTarget", "int32", [
	"void *",
	"uint32",
	"uint32",
	"bool",
]) as KoffiFunc<(target: Buffer, eventClass: number, eventId: number, askUserIfNeeded: boolean) => number>;

/**
 * Asks for Screen Recording: the first call shows macOS's dialog and lists this app in System Settings > Privacy &
 * Security > Screen & System Audio Recording; later calls only answer. True when it is already granted.
 */
export function requestScreenRecording(): boolean {
	return CGRequestScreenCaptureAccess();
}

/**
 * Asks for Accessibility: shows macOS's dialog (with its Open System Settings button) and lists this app, switched
 * off, in System Settings > Privacy & Security > Accessibility. True when it is already granted.
 */
export function requestAccessibility(): boolean {
	const promptKey = koffi.decode(
		applicationServices.symbol("kAXTrustedCheckOptionPrompt", "void *"),
		"void *",
	) as CFTypeRef | null;
	if (promptKey === null) {
		throw new Error("kAXTrustedCheckOptionPrompt is unavailable");
	}
	const options = CFDictionaryCreate(
		null,
		[promptKey],
		[cfBooleanTrue()],
		1,
		coreFoundation.symbol("kCFTypeDictionaryKeyCallBacks", "void *"),
		coreFoundation.symbol("kCFTypeDictionaryValueCallBacks", "void *"),
	);
	if (options === null) {
		throw new Error("CFDictionaryCreate returned null");
	}
	try {
		return AXIsProcessTrustedWithOptions(options);
	} finally {
		cfRelease(options);
	}
}

/** Whether this process may send Apple Events to an app (System Settings > Privacy & Security > Automation). */
export type AutomationStatus = "granted" | "denied" | "not-determined" | "not-running" | "unknown";

export function automationStatusFromCode(code: number): AutomationStatus {
	switch (code) {
		case NO_ERR:
			return "granted";
		case ERR_AE_EVENT_NOT_PERMITTED:
			return "denied";
		case ERR_AE_EVENT_WOULD_REQUIRE_USER_CONSENT:
			return "not-determined";
		case PROC_NOT_FOUND:
			return "not-running";
		default:
			return "unknown";
	}
}

/**
 * The Automation permission for the app with `bundleId`, which must be running. With `ask` the call shows macOS's
 * "wants access to control" dialog when the person has not decided yet, and blocks until they answer; without it,
 * it only reads.
 */
export function automationPermission(bundleId: string, ask: boolean): AutomationStatus {
	const data = Buffer.from(bundleId, "utf8");
	const target = Buffer.alloc(AE_DESC_SIZE);
	const created = AECreateDesc(TYPE_APPLICATION_BUNDLE_ID, data, data.length, target);
	if (created !== NO_ERR) {
		return "unknown";
	}
	try {
		return automationStatusFromCode(
			AEDeterminePermissionToAutomateTarget(target, TYPE_WILD_CARD, TYPE_WILD_CARD, ask),
		);
	} finally {
		AEDisposeDesc(target);
	}
}
