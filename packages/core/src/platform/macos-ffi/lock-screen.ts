import type { KoffiFunc } from "koffi";
import {
	type CFTypeRef,
	cfArrayLength,
	cfArrayValueAt,
	cfDictionaryValue,
	cfRelease,
	fromCFBoolean,
	fromCFNumber,
	isCFArray,
	isCFBoolean,
	isCFDictionary,
	isCFNumber,
	withCFString,
} from "./corefoundation.js";
import { koffi } from "./koffi.js";

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
const ioKit = koffi.load("/System/Library/Frameworks/IOKit.framework/IOKit");

const CGSessionCopyCurrentDictionary = coreGraphics.func("CGSessionCopyCurrentDictionary", "void *", []) as KoffiFunc<
	() => CFTypeRef | null
>;

const CFDictionaryGetValue = coreFoundation.func("CFDictionaryGetValue", "void *", ["void *", "void *"]) as KoffiFunc<
	(dictionary: CFTypeRef, key: CFTypeRef) => CFTypeRef | null
>;

const IORegistryGetRootEntry = ioKit.func("IORegistryGetRootEntry", "uint32_t", ["uint32_t"]) as KoffiFunc<
	(mainPort: number) => number
>;

const IORegistryEntryCreateCFProperty = ioKit.func("IORegistryEntryCreateCFProperty", "void *", [
	"uint32_t",
	"void *",
	"void *",
	"uint32_t",
]) as KoffiFunc<(entry: number, key: CFTypeRef, allocator: null, options: number) => CFTypeRef | null>;

const IOObjectRelease = ioKit.func("IOObjectRelease", "int32_t", ["uint32_t"]) as KoffiFunc<(object: number) => number>;

const IO_MAIN_PORT_DEFAULT = 0;
const CONSOLE_USERS_KEY = "IOConsoleUsers";
const ON_CONSOLE_KEY = "kCGSSessionOnConsoleKey";
const SCREEN_IS_LOCKED_KEY = "CGSSessionScreenIsLocked";
/** The one session identifier both this process's CGSession dictionary and IOConsoleUsers carry. */
const SESSION_ID_KEY = "kCGSSessionAuditIDKey";

function booleanValue(value: CFTypeRef | null | undefined): boolean | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	if (isCFBoolean(value)) {
		return fromCFBoolean(value);
	}
	if (isCFNumber(value)) {
		return fromCFNumber(value) !== 0;
	}
	return undefined;
}

function currentSessionId(): number | undefined {
	const session = CGSessionCopyCurrentDictionary();
	if (session === null) {
		return undefined;
	}
	try {
		return withCFString(SESSION_ID_KEY, (key) => {
			const value = CFDictionaryGetValue(session, key);
			return value !== null && value !== undefined && isCFNumber(value) ? fromCFNumber(value) : undefined;
		});
	} finally {
		cfRelease(session);
	}
}

/**
 * This process's session lock flag as the IORegistry publishes it. This is the reliable source:
 * the per-process CGSession dictionary no longer carries the lock key on current macOS. The entry
 * is matched by session id, not by which session owns the console: with fast user switching or a
 * remote session, another user's locked console says nothing about the session driving the apps.
 * Undefined when the session is not listed.
 */
function registrySessionLocked(sessionId: number | undefined): boolean | undefined {
	const root = IORegistryGetRootEntry(IO_MAIN_PORT_DEFAULT);
	if (root === 0) {
		return undefined;
	}
	try {
		const users = withCFString(CONSOLE_USERS_KEY, (key) => IORegistryEntryCreateCFProperty(root, key, null, 0));
		if (users === null || users === undefined) {
			return undefined;
		}
		try {
			if (!isCFArray(users)) {
				return undefined;
			}
			for (let index = 0; index < cfArrayLength(users); index += 1) {
				const session = cfArrayValueAt(users, index);
				if (session === null || !isCFDictionary(session)) {
					continue;
				}
				const matches =
					sessionId === undefined
						? withCFString(ON_CONSOLE_KEY, (key) => booleanValue(cfDictionaryValue(session, key))) === true
						: withCFString(SESSION_ID_KEY, (key) => {
								const value = cfDictionaryValue(session, key);
								return value !== null && isCFNumber(value) && fromCFNumber(value) === sessionId;
							});
				if (!matches) {
					continue;
				}
				return withCFString(SCREEN_IS_LOCKED_KEY, (key) => booleanValue(cfDictionaryValue(session, key))) ?? false;
			}
			return undefined;
		} finally {
			cfRelease(users);
		}
	} finally {
		IOObjectRelease(root);
	}
}

function currentSessionLocked(): boolean {
	const session = CGSessionCopyCurrentDictionary();
	if (session === null) {
		return false;
	}
	try {
		return withCFString(SCREEN_IS_LOCKED_KEY, (key) => booleanValue(CFDictionaryGetValue(session, key)) ?? false);
	} finally {
		cfRelease(session);
	}
}

/**
 * Whether this process's login session owns the physical console. False under Screen Sharing into a
 * second user's session (fast user switching), where windows can be observed but some UI never renders.
 * Undefined when the session dictionary carries no answer.
 */
export function sessionOnConsole(): boolean | undefined {
	try {
		const session = CGSessionCopyCurrentDictionary();
		if (session === null) {
			return undefined;
		}
		try {
			return withCFString(ON_CONSOLE_KEY, (key) => booleanValue(CFDictionaryGetValue(session, key)));
		} finally {
			cfRelease(session);
		}
	} catch {
		return undefined;
	}
}

export function isScreenLocked(): boolean {
	try {
		return registrySessionLocked(currentSessionId()) ?? currentSessionLocked();
	} catch {
		return false;
	}
}
