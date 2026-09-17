import type { KoffiFunc } from "koffi";
import { koffi } from "./koffi.js";

const NS_APPLICATION_ACTIVATION_POLICY_REGULAR = 0;

const appKit = koffi.load("/System/Library/Frameworks/AppKit.framework/AppKit");
const objc = koffi.load("/usr/lib/libobjc.A.dylib");
void appKit;

const objcGetClass = objc.func("objc_getClass", "void *", ["str"]) as KoffiFunc<(name: string) => object | null>;
const selRegisterName = objc.func("sel_registerName", "void *", ["str"]) as KoffiFunc<(name: string) => object | null>;
const msgPointer = objc.func("objc_msgSend", "void *", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => object | null
>;
const msgPointerObject = objc.func("objc_msgSend", "void *", ["void *", "void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object, value: object) => object | null
>;
const msgPointerCString = objc.func("objc_msgSend", "void *", ["void *", "void *", "str"]) as KoffiFunc<
	(receiver: object, selector: object, value: string) => object | null
>;
const msgPointerInteger = objc.func("objc_msgSend", "void *", ["void *", "void *", "uint64_t"]) as KoffiFunc<
	(receiver: object, selector: object, value: number) => object | null
>;
const msgPointerProcessIdentifier = objc.func("objc_msgSend", "void *", ["void *", "void *", "int32_t"]) as KoffiFunc<
	(receiver: object, selector: object, value: number) => object | null
>;
const msgUnsignedInteger = objc.func("objc_msgSend", "uint64_t", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => number
>;
const msgInteger = objc.func("objc_msgSend", "int64_t", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => number
>;
const msgProcessIdentifier = objc.func("objc_msgSend", "int32_t", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => number
>;
const msgBool = objc.func("objc_msgSend", "bool", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => boolean
>;
const msgCString = objc.func("objc_msgSend", "str", ["void *", "void *"]) as KoffiFunc<
	(receiver: object, selector: object) => string | null
>;
const msgBoolUnsignedInteger = objc.func("objc_msgSend", "bool", ["void *", "void *", "uint64_t"]) as KoffiFunc<
	(receiver: object, selector: object, value: number) => boolean
>;

/** NSApplicationActivateIgnoringOtherApps. */
const ACTIVATE_IGNORING_OTHER_APPS = 1 << 1;

const autoreleasePoolClass = requireClass("NSAutoreleasePool");
const bundleClass = requireClass("NSBundle");
const runningApplicationClass = requireClass("NSRunningApplication");
const workspaceClass = requireClass("NSWorkspace");

const activationPolicySelector = requireSelector("activationPolicy");
const activateWithOptionsSelector = requireSelector("activateWithOptions:");
const allocSelector = requireSelector("alloc");
const bundleIdentifierSelector = requireSelector("bundleIdentifier");
const bundleUrlSelector = requireSelector("bundleURL");
const bundleWithPathSelector = requireSelector("bundleWithPath:");
const countSelector = requireSelector("count");
const fullPathForApplicationSelector = requireSelector("fullPathForApplication:");
const initSelector = requireSelector("init");
const isActiveSelector = requireSelector("isActive");
const localizedNameSelector = requireSelector("localizedName");
const objectAtIndexSelector = requireSelector("objectAtIndex:");
const pathSelector = requireSelector("path");
const processIdentifierSelector = requireSelector("processIdentifier");
const releaseSelector = requireSelector("release");
const runningApplicationWithProcessIdentifierSelector = requireSelector("runningApplicationWithProcessIdentifier:");
const runningApplicationsSelector = requireSelector("runningApplications");
const runningApplicationsWithBundleIdentifierSelector = requireSelector("runningApplicationsWithBundleIdentifier:");
const sharedWorkspaceSelector = requireSelector("sharedWorkspace");
const stringWithUtf8StringSelector = requireSelector("stringWithUTF8String:");
const utf8StringSelector = requireSelector("UTF8String");
const stringClass = requireClass("NSString");

export interface WorkspaceRunningApplication {
	readonly name: string;
	readonly bundleId: string;
	readonly pid: number;
	readonly isActive: boolean;
	readonly path: string;
}

export type RunningApplicationIdentifier = string | number;

/**
 * Bring a running application forward — the ⌘-Tab effect, without the window-level raise a
 * specific window may need afterwards. Returns false when the process is not running or refuses
 * to activate (a full-screen menu-bar app can take focus back within a second).
 */
export function activateApplication(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return false;
	}
	return withAutoreleasePool(() => {
		const application = msgPointerProcessIdentifier(
			runningApplicationClass,
			runningApplicationWithProcessIdentifierSelector,
			pid,
		);
		if (application === null) {
			return false;
		}
		return msgBoolUnsignedInteger(application, activateWithOptionsSelector, ACTIVATE_IGNORING_OTHER_APPS);
	});
}

export function getRunningApplications(): WorkspaceRunningApplication[] {
	return withAutoreleasePool(() => {
		const applications = msgPointer(sharedWorkspace(), runningApplicationsSelector);
		return applications === null ? [] : readApplicationArray(applications);
	});
}

export function findRunningApplication(
	identifier: RunningApplicationIdentifier,
): WorkspaceRunningApplication | undefined {
	return withAutoreleasePool(() => {
		if (typeof identifier === "number") {
			if (!Number.isSafeInteger(identifier) || identifier <= 0) {
				return undefined;
			}
			const application = msgPointerProcessIdentifier(
				runningApplicationClass,
				runningApplicationWithProcessIdentifierSelector,
				identifier,
			);
			return application === null ? undefined : readApplication(application);
		}

		const bundleId = resolveBundleIdentifier(identifier);
		if (bundleId === undefined) {
			return undefined;
		}
		const bundleIdReference = nsString(bundleId);
		const indexed = msgPointerObject(
			runningApplicationClass,
			runningApplicationsWithBundleIdentifierSelector,
			bundleIdReference,
		);
		if (indexed !== null) {
			const match = readApplicationArray(indexed).find((application) => application.bundleId === bundleId);
			if (match !== undefined) {
				return match;
			}
		}
		// AppKit's indexed lookup answers with an empty set now and then on a loaded machine, which
		// would report a running app as missing and disable a whole turn; the enumeration is the
		// second, independent source for the same question. It stays off the fast path on purpose.
		return getRunningApplications().find((application) => application.bundleId === bundleId);
	});
}

function readApplicationArray(array: object): WorkspaceRunningApplication[] {
	const count = msgUnsignedInteger(array, countSelector);
	const applications: WorkspaceRunningApplication[] = [];
	for (let index = 0; index < count; index += 1) {
		const reference = msgPointerInteger(array, objectAtIndexSelector, index);
		if (reference === null) {
			continue;
		}
		const application = readApplication(reference);
		if (application !== undefined) {
			applications.push(application);
		}
	}
	return applications;
}

function readApplication(reference: object): WorkspaceRunningApplication | undefined {
	if (msgInteger(reference, activationPolicySelector) !== NS_APPLICATION_ACTIVATION_POLICY_REGULAR) {
		return undefined;
	}
	const name = readStringProperty(reference, localizedNameSelector);
	const bundleId = readStringProperty(reference, bundleIdentifierSelector);
	const pid = msgProcessIdentifier(reference, processIdentifierSelector);
	if (name.length === 0 || bundleId.length === 0 || !Number.isSafeInteger(pid) || pid <= 0) {
		return undefined;
	}
	const bundleUrl = msgPointer(reference, bundleUrlSelector);
	const path = bundleUrl === null ? "" : readStringProperty(bundleUrl, pathSelector);
	return {
		name,
		bundleId,
		pid,
		isActive: msgBool(reference, isActiveSelector),
		path,
	};
}

function resolveBundleIdentifier(bundleIdOrName: string): string | undefined {
	if (bundleIdOrName.length === 0) {
		return undefined;
	}
	const directMatches = runningApplicationsWithBundleIdentifier(bundleIdOrName);
	if (directMatches !== null && msgUnsignedInteger(directMatches, countSelector) > 0) {
		return bundleIdOrName;
	}
	const applicationPath = msgPointerObject(
		sharedWorkspace(),
		fullPathForApplicationSelector,
		nsString(bundleIdOrName),
	);
	if (applicationPath !== null) {
		const bundle = msgPointerObject(bundleClass, bundleWithPathSelector, applicationPath);
		const resolved = bundle === null ? undefined : nonEmptyStringProperty(bundle, bundleIdentifierSelector);
		if (resolved !== undefined) {
			return resolved;
		}
	}
	// AppKit's indexed query answers with an empty set now and then on a loaded machine, and a
	// bundle identifier has no path to fall back on, so a running app would be reported as missing.
	// The enumeration knows the same ids; it runs only when everything else came up empty.
	return getRunningApplications().some((application) => application.bundleId === bundleIdOrName)
		? bundleIdOrName
		: undefined;
}

function runningApplicationsWithBundleIdentifier(bundleId: string): object | null {
	return msgPointerObject(
		runningApplicationClass,
		runningApplicationsWithBundleIdentifierSelector,
		nsString(bundleId),
	);
}

function sharedWorkspace(): object {
	const workspace = msgPointer(workspaceClass, sharedWorkspaceSelector);
	if (workspace === null) {
		throw new Error("NSWorkspace.sharedWorkspace returned null");
	}
	return workspace;
}

function nsString(value: string): object {
	const reference = msgPointerCString(stringClass, stringWithUtf8StringSelector, value);
	if (reference === null) {
		throw new Error("NSString.stringWithUTF8String returned null");
	}
	return reference;
}

function nonEmptyStringProperty(receiver: object, selector: object): string | undefined {
	const value = readStringProperty(receiver, selector);
	return value.length === 0 ? undefined : value;
}

function readStringProperty(receiver: object, selector: object): string {
	const value = msgPointer(receiver, selector);
	return value === null ? "" : (msgCString(value, utf8StringSelector) ?? "");
}

function withAutoreleasePool<T>(operation: () => T): T {
	const allocated = msgPointer(autoreleasePoolClass, allocSelector);
	if (allocated === null) {
		throw new Error("NSAutoreleasePool.alloc returned null");
	}
	const pool = msgPointer(allocated, initSelector);
	if (pool === null) {
		msgPointer(allocated, releaseSelector);
		throw new Error("NSAutoreleasePool.init returned null");
	}
	try {
		return operation();
	} finally {
		msgPointer(pool, releaseSelector);
	}
}

function requireClass(name: string): object {
	const value = objcGetClass(name);
	if (value === null) {
		throw new Error(`Objective-C class not found: ${name}`);
	}
	return value;
}

function requireSelector(name: string): object {
	const value = selRegisterName(name);
	if (value === null) {
		throw new Error(`Objective-C selector not found: ${name}`);
	}
	return value;
}
