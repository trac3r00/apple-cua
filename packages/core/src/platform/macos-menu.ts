import { setTimeout as sleep } from "node:timers/promises";
import type { KoffiFunc } from "koffi";
import {
	type AXUIElementRef,
	copyAttributeValue,
	createApplicationElement,
	performAction,
	releaseAXElement,
} from "./macos-ffi/accessibility.js";
import {
	type CFArrayRef,
	cfArrayLength,
	cfArrayValueAt,
	cfRelease,
	cfRetain,
	fromCFBoolean,
	fromCFString,
	isCFBoolean,
	isCFString,
} from "./macos-ffi/corefoundation.js";
import { koffi } from "./macos-ffi/koffi.js";

const MENU_SETTLE_MILLISECONDS = 80;
const ACTION_PRIORITY = ["AXPress", "AXPick", "AXShowMenu", "AXOpen"] as const;

const applicationServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const AX_UI_ELEMENT_REF = koffi.pointer("AXUIElementRefForMenu", koffi.opaque());
const AXUIElementCopyActionNames = applicationServices.func("AXUIElementCopyActionNames", "int32_t", [
	AX_UI_ELEMENT_REF,
	"_Out_ void **",
]) as KoffiFunc<(element: AXUIElementRef, actions: Array<CFArrayRef | null>) => number>;

export interface MenuAccessibility {
	createApplication(pid: number): AXUIElementRef;
	elementAttribute(element: AXUIElementRef, attribute: string): AXUIElementRef | null;
	copyChildren(element: AXUIElementRef): AXUIElementRef[];
	stringAttribute(element: AXUIElementRef, attribute: string): string | null;
	booleanAttribute(element: AXUIElementRef, attribute: string): boolean | null;
	actionNames(element: AXUIElementRef): string[];
	perform(element: AXUIElementRef, action: string): void;
	release(element: AXUIElementRef): void;
	delay(milliseconds: number): Promise<void>;
}

export interface InvokeMenuResult {
	readonly resolvedPath: readonly string[];
	readonly action: string;
}

export async function invokeMenu(
	pid: number,
	path: readonly string[],
	accessibility: MenuAccessibility = nativeMenuAccessibility,
): Promise<InvokeMenuResult> {
	const normalizedPath = normalizeMenuPath(path);
	const application = accessibility.createApplication(pid);
	let finalAction = "";
	try {
		for (let depth = 0; depth < normalizedPath.length; depth += 1) {
			const target = resolvePrefix(application, normalizedPath.slice(0, depth + 1), accessibility);
			try {
				if (accessibility.booleanAttribute(target, "AXEnabled") === false) {
					throw menuFailure(depth, normalizedPath, "is disabled");
				}
				const action = chooseMenuAction(accessibility.actionNames(target));
				if (action === undefined) {
					throw menuFailure(depth, normalizedPath, "has no usable native menu action");
				}
				try {
					accessibility.perform(target, action);
				} catch (error: unknown) {
					const details = error instanceof Error ? error.message : String(error);
					throw menuFailure(depth, normalizedPath, `native action ${action} failed: ${details}`);
				}
				finalAction = action;
			} finally {
				accessibility.release(target);
			}
			if (depth + 1 < normalizedPath.length) {
				await accessibility.delay(MENU_SETTLE_MILLISECONDS);
			}
		}
	} finally {
		accessibility.release(application);
	}
	return { resolvedPath: normalizedPath, action: finalAction };
}

export function normalizeMenuPath(path: readonly string[]): string[] {
	if (path.length < 1 || path.length > 16) {
		throw new Error("invoke_menu: path must contain between 1 and 16 segments");
	}
	return path.map((segment, index) => {
		const normalized = segment.trim();
		if (normalized.length === 0) {
			throw new Error(`invoke_menu: path segment ${index} is empty`);
		}
		return normalized;
	});
}

export function chooseMenuAction(actions: readonly string[]): string | undefined {
	return ACTION_PRIORITY.find((action) => actions.includes(action));
}

function resolvePrefix(
	application: AXUIElementRef,
	prefix: readonly string[],
	accessibility: MenuAccessibility,
): AXUIElementRef {
	const menuBar = accessibility.elementAttribute(application, "AXMenuBar");
	if (menuBar === null) {
		throw new Error("invoke_menu: target exposes no AXMenuBar; failed at hop 0");
	}
	let current = menuBar;
	try {
		for (let depth = 0; depth < prefix.length; depth += 1) {
			const children = semanticChildren(current, accessibility);
			const segment = prefix[depth];
			const matches: AXUIElementRef[] = [];
			for (const child of children) {
				if (accessibility.stringAttribute(child, "AXTitle") === segment) {
					matches.push(child);
				} else {
					accessibility.release(child);
				}
			}
			if (matches.length !== 1) {
				for (const match of matches) {
					accessibility.release(match);
				}
				throw menuFailure(depth, prefix, matches.length === 0 ? "was not found" : "is ambiguous");
			}
			const next = matches[0];
			if (next === undefined) {
				throw new Error("invoke_menu: internal menu match disappeared");
			}
			accessibility.release(current);
			current = next;
		}
		return current;
	} catch (error) {
		accessibility.release(current);
		throw error;
	}
}

function semanticChildren(parent: AXUIElementRef, accessibility: MenuAccessibility): AXUIElementRef[] {
	const result: AXUIElementRef[] = [];
	for (const child of accessibility.copyChildren(parent)) {
		if (accessibility.stringAttribute(child, "AXRole") === "AXMenu") {
			result.push(...accessibility.copyChildren(child));
			accessibility.release(child);
		} else {
			result.push(child);
		}
	}
	return result;
}

function menuFailure(depth: number, path: readonly string[], reason: string): Error {
	return new Error(`invoke_menu: path segment ${depth} ("${path[depth] ?? ""}") ${reason}; failed at hop ${depth}`);
}

function copyElementAttribute(element: AXUIElementRef, attribute: string): AXUIElementRef | null {
	try {
		return copyAttributeValue(element, attribute);
	} catch {
		return null;
	}
}

function nativeCopyChildren(element: AXUIElementRef): AXUIElementRef[] {
	const value = copyElementAttribute(element, "AXChildren");
	if (value === null) {
		return [];
	}
	try {
		const children: AXUIElementRef[] = [];
		for (let index = 0; index < cfArrayLength(value); index += 1) {
			const child = cfArrayValueAt(value, index);
			if (child !== null) {
				children.push(cfRetain(child));
			}
		}
		return children;
	} finally {
		cfRelease(value);
	}
}

function nativeStringAttribute(element: AXUIElementRef, attribute: string): string | null {
	const value = copyElementAttribute(element, attribute);
	if (value === null) {
		return null;
	}
	try {
		return isCFString(value) ? fromCFString(value) : null;
	} finally {
		cfRelease(value);
	}
}

function nativeBooleanAttribute(element: AXUIElementRef, attribute: string): boolean | null {
	const value = copyElementAttribute(element, attribute);
	if (value === null) {
		return null;
	}
	try {
		return isCFBoolean(value) ? fromCFBoolean(value) : null;
	} finally {
		cfRelease(value);
	}
}

function nativeActionNames(element: AXUIElementRef): string[] {
	const out: Array<CFArrayRef | null> = [null];
	if (AXUIElementCopyActionNames(element, out) !== 0) {
		return [];
	}
	const actions = out[0];
	if (actions === undefined || actions === null) {
		return [];
	}
	try {
		const names: string[] = [];
		for (let index = 0; index < cfArrayLength(actions); index += 1) {
			const action = cfArrayValueAt(actions, index);
			if (action !== null && isCFString(action)) {
				names.push(fromCFString(action));
			}
		}
		return names;
	} finally {
		cfRelease(actions);
	}
}

const nativeMenuAccessibility: MenuAccessibility = {
	createApplication: createApplicationElement,
	elementAttribute: copyElementAttribute,
	copyChildren: nativeCopyChildren,
	stringAttribute: nativeStringAttribute,
	booleanAttribute: nativeBooleanAttribute,
	actionNames: nativeActionNames,
	perform: performAction,
	release: releaseAXElement,
	delay: async (milliseconds) => await sleep(milliseconds),
};
