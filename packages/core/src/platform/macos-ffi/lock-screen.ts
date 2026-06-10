import type { KoffiFunc } from "koffi";
import { type CFTypeRef, cfRelease, fromCFNumber, withCFString } from "./corefoundation.js";
import { koffi } from "./koffi.js";

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");

const CGSessionCopyCurrentDictionary = coreGraphics.func("CGSessionCopyCurrentDictionary", "void *", []) as KoffiFunc<
	() => CFTypeRef | null
>;

const CFDictionaryGetValue = coreFoundation.func("CFDictionaryGetValue", "void *", ["void *", "void *"]) as KoffiFunc<
	(dictionary: CFTypeRef, key: CFTypeRef) => CFTypeRef | null
>;

const SCREEN_IS_LOCKED_KEY = "CGSSessionScreenIsLocked";

export function isScreenLocked(): boolean {
	try {
		const session = CGSessionCopyCurrentDictionary();
		if (session === null) {
			return false;
		}
		try {
			return withCFString(SCREEN_IS_LOCKED_KEY, (key) => {
				const value = CFDictionaryGetValue(session, key);
				if (value === null || value === undefined) {
					return false;
				}
				return fromCFNumber(value) === 1;
			});
		} finally {
			cfRelease(session);
		}
	} catch {
		return false;
	}
}
