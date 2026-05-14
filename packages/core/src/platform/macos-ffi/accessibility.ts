import type { KoffiFunc } from "koffi";
import { type CFStringRef, type CFTypeRef, cfRelease, toCFString, withCFString } from "./corefoundation.js";
import { koffi } from "./koffi.js";

export type AXUIElementRef = CFTypeRef;

export const K_AX_PRESS_ACTION = "AXPress";
export const K_AX_VALUE_ATTRIBUTE = "AXValue";
export const K_AX_FOCUSED_UI_ELEMENT_ATTRIBUTE = "AXFocusedUIElement";
export const K_AX_ROLE_ATTRIBUTE = "AXRole";
export const K_AX_TITLE_ATTRIBUTE = "AXTitle";

const AX_SUCCESS = 0;

const applicationServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const AX_UI_ELEMENT_REF = koffi.pointer("AXUIElementRef", koffi.opaque());
const CF_TYPE_REF = koffi.pointer("CFTypeRef", koffi.opaque());
const CF_TYPE_REF_OUT = koffi.out(CF_TYPE_REF);

const AXUIElementCreateApplication = applicationServices.func("AXUIElementCreateApplication", AX_UI_ELEMENT_REF, [
	"int32_t",
]) as KoffiFunc<(pid: number) => AXUIElementRef | null>;

const AXUIElementPerformAction = applicationServices.func("AXUIElementPerformAction", "int32_t", [
	AX_UI_ELEMENT_REF,
	CF_TYPE_REF,
]) as KoffiFunc<(element: AXUIElementRef, action: CFStringRef) => number>;

const AXUIElementSetAttributeValue = applicationServices.func("AXUIElementSetAttributeValue", "int32_t", [
	AX_UI_ELEMENT_REF,
	CF_TYPE_REF,
	CF_TYPE_REF,
]) as KoffiFunc<(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) => number>;

const AXUIElementCopyAttributeValue = applicationServices.func("AXUIElementCopyAttributeValue", "int32_t", [
	AX_UI_ELEMENT_REF,
	CF_TYPE_REF,
	CF_TYPE_REF_OUT,
]) as KoffiFunc<(element: AXUIElementRef, attribute: CFStringRef, value: Array<CFTypeRef | null>) => number>;

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

function assertAXSuccess(operation: string, error: number): void {
	if (error !== AX_SUCCESS) {
		throw new Error(`${operation} failed with AXError ${error}`);
	}
}
