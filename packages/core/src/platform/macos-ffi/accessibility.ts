import type { KoffiFunc } from "koffi";
import type { AXTreeElement } from "../../accessibility/types.js";
import {
	type CFArrayRef,
	type CFStringRef,
	type CFTypeRef,
	cfArrayLength,
	cfArrayValueAt,
	cfGetTypeId,
	cfRelease,
	cfRetain,
	fromCFBoolean,
	fromCFNumber,
	fromCFString,
	isCFBoolean,
	isCFNumber,
	isCFString,
	toCFString,
	withCFString,
} from "./corefoundation.js";
import { koffi } from "./koffi.js";

export type AXUIElementRef = CFTypeRef;
export type AXValueRef = CFTypeRef;

export const K_AX_PRESS_ACTION = "AXPress";
export const K_AX_VALUE_ATTRIBUTE = "AXValue";
export const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE = "AXFocusedUIElement";
export const K_AX_ROLE_ATTRIBUTE = "AXRole";
export const K_AX_TITLE_ATTRIBUTE = "AXTitle";
export const K_AX_DESCRIPTION_ATTRIBUTE = "AXDescription";
export const K_AX_POSITION_ATTRIBUTE = "AXPosition";
export const K_AX_SIZE_ATTRIBUTE = "AXSize";
export const K_AX_CHILDREN_ATTRIBUTE = "AXChildren";
export const K_AX_SELECTED_TEXT_ATTRIBUTE = "AXSelectedText";
export const K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE = "AXSelectedTextRange";

const AX_SUCCESS = 0;
const AX_VALUE_CG_POINT = 1;
const AX_VALUE_CG_SIZE = 2;
const DOUBLE_SIZE = 8;
const CG_PAIR_SIZE = DOUBLE_SIZE * 2;

const applicationServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const AX_UI_ELEMENT_REF = koffi.pointer("AXUIElementRef", koffi.opaque());
const AX_VALUE_REF = koffi.pointer("AXValueRef", koffi.opaque());

const AXIsProcessTrusted = applicationServices.func("AXIsProcessTrusted", "bool", []) as KoffiFunc<() => boolean>;

const AXUIElementGetTypeID = applicationServices.func("AXUIElementGetTypeID", "ulong", []) as KoffiFunc<() => number>;

const AXValueGetTypeID = applicationServices.func("AXValueGetTypeID", "ulong", []) as KoffiFunc<() => number>;

const AXValueGetType = applicationServices.func("AXValueGetType", "int32_t", [AX_VALUE_REF]) as KoffiFunc<
	(value: AXValueRef) => number
>;

const AXValueGetValue = applicationServices.func("AXValueGetValue", "bool", [
	AX_VALUE_REF,
	"int32_t",
	"void *",
]) as KoffiFunc<(value: AXValueRef, type: number, buffer: Buffer) => boolean>;

const AXUIElementCreateApplication = applicationServices.func("AXUIElementCreateApplication", AX_UI_ELEMENT_REF, [
	"int32_t",
]) as KoffiFunc<(pid: number) => AXUIElementRef | null>;

const AXUIElementCreateSystemWide = applicationServices.func(
	"AXUIElementCreateSystemWide",
	AX_UI_ELEMENT_REF,
	[],
) as KoffiFunc<() => AXUIElementRef | null>;

const AXUIElementCopyElementAtPosition = applicationServices.func(
	"int32_t AXUIElementCopyElementAtPosition(void *element, float x, float y, _Out_ void **target)",
) as KoffiFunc<(application: AXUIElementRef, x: number, y: number, target: Array<AXUIElementRef | null>) => number>;

const AXUIElementGetPid = applicationServices.func(
	"int32_t AXUIElementGetPid(void *element, _Out_ int32_t *pid)",
) as KoffiFunc<(element: AXUIElementRef, pidOut: Int32Array) => number>;

const AXUIElementPerformAction = applicationServices.func("AXUIElementPerformAction", "int32_t", [
	AX_UI_ELEMENT_REF,
	"void *",
]) as KoffiFunc<(element: AXUIElementRef, action: CFStringRef) => number>;

const AXUIElementSetAttributeValue = applicationServices.func("AXUIElementSetAttributeValue", "int32_t", [
	AX_UI_ELEMENT_REF,
	"void *",
	"void *",
]) as KoffiFunc<(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) => number>;

const AXUIElementCopyAttributeValue = applicationServices.func(
	"int32_t AXUIElementCopyAttributeValue(void *element, void *attribute, _Out_ void **value)",
) as KoffiFunc<(element: AXUIElementRef, attribute: CFStringRef, value: Array<CFTypeRef | null>) => number>;

const AXUIElementCopyActionNames = applicationServices.func(
	"int32_t AXUIElementCopyActionNames(void *element, _Out_ void **actions)",
) as KoffiFunc<(element: AXUIElementRef, actions: Array<CFArrayRef | null>) => number>;

export interface AccessibilityTreeResult {
	readonly elements: AXTreeElement[];
	readonly axAvailable: boolean;
}

export function createApplicationElement(pid: number): AXUIElementRef {
	const element = AXUIElementCreateApplication(pid);
	if (element === null) {
		throw new Error(`AXUIElementCreateApplication returned null for pid ${pid}`);
	}
	return element;
}

export function releaseAXElement(element: AXUIElementRef | null): void {
	cfRelease(element);
}

export function performAction(element: AXUIElementRef, action: string): void {
	withCFString(action, (actionReference) => {
		assertAXSuccess("AXUIElementPerformAction", AXUIElementPerformAction(element, actionReference));
	});
}

export function setAttributeValue(element: AXUIElementRef, attribute: string, value: CFTypeRef): void {
	withCFString(attribute, (attributeReference) => {
		assertAXSuccess("AXUIElementSetAttributeValue", AXUIElementSetAttributeValue(element, attributeReference, value));
	});
}

export function setStringAttributeValue(element: AXUIElementRef, attribute: string, value: string): void {
	const valueReference = toCFString(value);
	try {
		setAttributeValue(element, attribute, valueReference);
	} finally {
		cfRelease(valueReference);
	}
}

export function copyAttributeValue(element: AXUIElementRef, attribute: string): CFTypeRef | null {
	return withCFString(attribute, (attributeReference) => {
		const outValue: Array<CFTypeRef | null> = [null];
		const error = AXUIElementCopyAttributeValue(element, attributeReference, outValue);
		assertAXSuccess("AXUIElementCopyAttributeValue", error);
		const value = outValue[0];
		return value === undefined ? null : value;
	});
}

export function extractAccessibilityTree(pid: number, maxDepth = 10, maxElements = 2_000): AccessibilityTreeResult {
	if (!AXIsProcessTrusted() || !isRunning(pid) || maxDepth < 0 || maxElements <= 0) {
		return { elements: [], axAvailable: false };
	}

	const root = createApplicationElement(pid);
	try {
		if (copyElementChildren(root).length === 0) {
			return { elements: [], axAvailable: false };
		}

		const elements: AXTreeElement[] = [];
		appendAXElement(root, 0, maxDepth, maxElements, elements);
		return elements.length === 0 ? { elements: [], axAvailable: false } : { elements, axAvailable: true };
	} finally {
		releaseAXElement(root);
	}
}

export function performActionByIndex(pid: number, elementIndex: number, action: string): void {
	const element = refetchElement(pid, elementIndex);
	try {
		performAction(element, action);
	} finally {
		releaseAXElement(element);
	}
}

export function typeIntoFocusedAXElement(targetPid: number, text: string): boolean {
	if (!AXIsProcessTrusted() || !isRunning(targetPid) || text.length === 0) {
		return false;
	}
	const app = createApplicationElement(targetPid);
	try {
		const focused = copyOptionalAttributeValue(app, K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE);
		if (focused === null) {
			return false;
		}
		try {
			if (trySetSelectedText(focused, text)) {
				return true;
			}
			return tryAppendValue(focused, text);
		} finally {
			releaseAXElement(focused);
		}
	} finally {
		releaseAXElement(app);
	}
}

function trySetSelectedText(element: AXUIElementRef, text: string): boolean {
	return withCFString(K_AX_SELECTED_TEXT_ATTRIBUTE, (attributeReference) => {
		const valueReference = toCFString(text);
		try {
			return AXUIElementSetAttributeValue(element, attributeReference, valueReference) === AX_SUCCESS;
		} finally {
			cfRelease(valueReference);
		}
	});
}

function tryAppendValue(element: AXUIElementRef, text: string): boolean {
	const current = copyStringAttribute(element, K_AX_VALUE_ATTRIBUTE) ?? "";
	return withCFString(K_AX_VALUE_ATTRIBUTE, (attributeReference) => {
		const valueReference = toCFString(`${current}${text}`);
		try {
			return AXUIElementSetAttributeValue(element, attributeReference, valueReference) === AX_SUCCESS;
		} finally {
			cfRelease(valueReference);
		}
	});
}

export function pressElementAtScreenPoint(targetPid: number, x: number, y: number): boolean {
	if (!AXIsProcessTrusted() || !isRunning(targetPid)) {
		return false;
	}
	const systemwide = AXUIElementCreateSystemWide();
	if (systemwide === null) {
		return false;
	}
	try {
		const out: Array<AXUIElementRef | null> = [null];
		const error = AXUIElementCopyElementAtPosition(systemwide, x, y, out);
		if (error !== AX_SUCCESS) {
			return false;
		}
		const element = out[0];
		if (element === null || element === undefined) {
			return false;
		}
		try {
			const pidBuffer = new Int32Array(1);
			const pidError = AXUIElementGetPid(element, pidBuffer);
			if (pidError !== AX_SUCCESS || pidBuffer[0] !== targetPid) {
				return false;
			}
			const actions = copyActionNames(element);
			if (!actions.includes(K_AX_PRESS_ACTION)) {
				return false;
			}
			performAction(element, K_AX_PRESS_ACTION);
			return true;
		} finally {
			releaseAXElement(element);
		}
	} finally {
		releaseAXElement(systemwide);
	}
}

export function setValueByIndex(pid: number, elementIndex: number, value: string): void {
	const element = refetchElement(pid, elementIndex);
	try {
		setStringAttributeValue(element, K_AX_VALUE_ATTRIBUTE, value);
	} finally {
		releaseAXElement(element);
	}
}

export function refetchElement(pid: number, elementIndex: number, maxDepth = 10, maxElements = 2_000): AXUIElementRef {
	if (!AXIsProcessTrusted()) {
		throw new Error("accessibility permission denied");
	}
	if (!isRunning(pid) || elementIndex < 0 || elementIndex >= maxElements) {
		throw new Error(`invalid process or element index: ${pid}:${elementIndex}`);
	}

	const root = createApplicationElement(pid);
	try {
		const cursor = { value: 0 };
		const matched = findAXElement(root, elementIndex, 0, maxDepth, maxElements, cursor);
		if (matched === null) {
			throw new Error(`element ${elementIndex} not found`);
		}
		return matched;
	} finally {
		releaseAXElement(root);
	}
}

function appendAXElement(
	element: AXUIElementRef,
	depth: number,
	maxDepth: number,
	maxElements: number,
	elements: AXTreeElement[],
): number | undefined {
	if (depth > maxDepth || elements.length >= maxElements) {
		return undefined;
	}

	const id = elements.length;
	elements.push({
		id,
		role: copyStringAttribute(element, K_AX_ROLE_ATTRIBUTE) ?? "",
		label:
			copyStringAttribute(element, K_AX_TITLE_ATTRIBUTE) ?? copyStringAttribute(element, K_AX_DESCRIPTION_ATTRIBUTE),
		value: copyStringValueAttribute(element),
		frame: copyFrame(element),
		actions: copyActionNames(element),
		children: [],
	});

	const childIds: number[] = [];
	if (depth < maxDepth) {
		const children = copyElementChildren(element);
		try {
			for (const child of children) {
				if (elements.length >= maxElements) {
					break;
				}
				const childId = appendAXElement(child, depth + 1, maxDepth, maxElements, elements);
				if (childId !== undefined) {
					childIds.push(childId);
				}
			}
		} finally {
			for (const child of children) {
				releaseAXElement(child);
			}
		}
	}

	const current = elements[id];
	if (current === undefined) {
		throw new Error(`AX tree cursor lost element ${id}`);
	}
	elements[id] = { ...current, children: childIds };
	return id;
}

function findAXElement(
	element: AXUIElementRef,
	targetIndex: number,
	depth: number,
	maxDepth: number,
	maxElements: number,
	cursor: { value: number },
): AXUIElementRef | null {
	if (depth > maxDepth || cursor.value >= maxElements) {
		return null;
	}
	if (cursor.value === targetIndex) {
		return cfRetain(element);
	}
	cursor.value += 1;

	if (depth >= maxDepth) {
		return null;
	}

	const children = copyElementChildren(element);
	try {
		for (const child of children) {
			const matched = findAXElement(child, targetIndex, depth + 1, maxDepth, maxElements, cursor);
			if (matched !== null) {
				return matched;
			}
			if (cursor.value >= maxElements) {
				break;
			}
		}
		return null;
	} finally {
		for (const child of children) {
			releaseAXElement(child);
		}
	}
}

function copyStringAttribute(element: AXUIElementRef, attribute: string): string | null {
	const value = copyOptionalAttributeValue(element, attribute);
	if (value === null) {
		return null;
	}
	try {
		return stringFromValue(value);
	} finally {
		cfRelease(value);
	}
}

function copyStringValueAttribute(element: AXUIElementRef): string | null {
	const value = copyOptionalAttributeValue(element, K_AX_VALUE_ATTRIBUTE);
	if (value === null) {
		return null;
	}
	try {
		return stringFromValue(value);
	} finally {
		cfRelease(value);
	}
}

function stringFromValue(value: CFTypeRef): string | null {
	if (isCFString(value)) {
		return fromCFString(value);
	}
	if (isCFNumber(value)) {
		return String(fromCFNumber(value));
	}
	if (isCFBoolean(value)) {
		return String(fromCFBoolean(value));
	}
	return null;
}

function copyFrame(element: AXUIElementRef): AXTreeElement["frame"] {
	const position = copyPointAttribute(element, K_AX_POSITION_ATTRIBUTE) ?? { x: 0, y: 0 };
	const size = copySizeAttribute(element, K_AX_SIZE_ATTRIBUTE) ?? { width: 0, height: 0 };
	return { ...position, ...size };
}

function copyPointAttribute(element: AXUIElementRef, attribute: string): { x: number; y: number } | null {
	const value = copyOptionalAttributeValue(element, attribute);
	if (value === null) {
		return null;
	}
	try {
		if (!isAXValue(value) || AXValueGetType(value) !== AX_VALUE_CG_POINT) {
			return null;
		}
		const buffer = Buffer.alloc(CG_PAIR_SIZE);
		if (!AXValueGetValue(value, AX_VALUE_CG_POINT, buffer)) {
			return null;
		}
		return { x: buffer.readDoubleLE(0), y: buffer.readDoubleLE(DOUBLE_SIZE) };
	} finally {
		cfRelease(value);
	}
}

function copySizeAttribute(element: AXUIElementRef, attribute: string): { width: number; height: number } | null {
	const value = copyOptionalAttributeValue(element, attribute);
	if (value === null) {
		return null;
	}
	try {
		if (!isAXValue(value) || AXValueGetType(value) !== AX_VALUE_CG_SIZE) {
			return null;
		}
		const buffer = Buffer.alloc(CG_PAIR_SIZE);
		if (!AXValueGetValue(value, AX_VALUE_CG_SIZE, buffer)) {
			return null;
		}
		return { width: buffer.readDoubleLE(0), height: buffer.readDoubleLE(DOUBLE_SIZE) };
	} finally {
		cfRelease(value);
	}
}

function copyElementChildren(element: AXUIElementRef): AXUIElementRef[] {
	const value = copyOptionalAttributeValue(element, K_AX_CHILDREN_ATTRIBUTE);
	if (value === null) {
		return [];
	}
	try {
		const children: AXUIElementRef[] = [];
		for (let index = 0; index < cfArrayLength(value); index += 1) {
			const child = cfArrayValueAt(value, index);
			if (child !== null && cfGetTypeId(child) === AXUIElementGetTypeID()) {
				children.push(cfRetain(child));
			}
		}
		return children;
	} finally {
		cfRelease(value);
	}
}

function copyActionNames(element: AXUIElementRef): string[] {
	const outActions: Array<CFArrayRef | null> = [null];
	const error = AXUIElementCopyActionNames(element, outActions);
	if (error !== AX_SUCCESS) {
		return [];
	}
	const actions = outActions[0];
	if (actions === undefined || actions === null) {
		return [];
	}
	try {
		const names: string[] = [];
		for (let index = 0; index < cfArrayLength(actions); index += 1) {
			const value = cfArrayValueAt(actions, index);
			if (value !== null && isCFString(value)) {
				names.push(fromCFString(value));
			}
		}
		return names;
	} finally {
		cfRelease(actions);
	}
}

function copyOptionalAttributeValue(element: AXUIElementRef, attribute: string): CFTypeRef | null {
	return withCFString(attribute, (attributeReference) => {
		const outValue: Array<CFTypeRef | null> = [null];
		const error = AXUIElementCopyAttributeValue(element, attributeReference, outValue);
		if (error !== AX_SUCCESS) {
			return null;
		}
		const value = outValue[0];
		return value === undefined ? null : value;
	});
}

function isAXValue(value: CFTypeRef): value is AXValueRef {
	return cfGetTypeId(value) === AXValueGetTypeID();
}

function isRunning(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function assertAXSuccess(operation: string, error: number): void {
	if (error !== AX_SUCCESS) {
		throw new Error(`${operation} failed with AXError ${error}`);
	}
}
