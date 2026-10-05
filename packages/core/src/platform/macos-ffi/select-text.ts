import type { KoffiFunc } from "koffi";
import { resolveSelectionRange } from "../../computer/select-text.js";
import type { SelectTextOptions } from "../../types/index.js";
import {
	type AXUIElementRef,
	K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE,
	K_AX_VALUE_ATTRIBUTE,
	copyAttributeValue,
	focusedTextEntryElement,
	refetchElement,
	releaseAXElement,
	setAttributeValue,
} from "./accessibility.js";
import { type CFTypeRef, cfRelease, fromCFString, isCFString, toCFString } from "./corefoundation.js";
import { koffi } from "./koffi.js";

const applicationServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const AX_VALUE_REF = koffi.pointer("AXValueRefForSelectText", koffi.opaque());

const AXValueCreate = applicationServices.func("AXValueCreate", AX_VALUE_REF, ["int32_t", "void *"]) as KoffiFunc<
	(type: number, valuePtr: Buffer) => CFTypeRef | null
>;

const K_AX_VALUE_CF_RANGE_TYPE = 4;
const CF_RANGE_BYTES = 16;
const CF_RANGE_LENGTH_OFFSET = 8;

export function selectTextByIndex(pid: number, elementIndex: number, options: SelectTextOptions): void {
	const element = refetchElement(pid, elementIndex);
	try {
		const value = readElementText(element);
		const range = resolveSelectionRange({ value, ...options });
		const axValue = createCFRangeValue(range);
		try {
			setAttributeValue(element, K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE, axValue);
		} finally {
			cfRelease(axValue);
		}
	} finally {
		releaseAXElement(element);
	}
}

/**
 * Select the whole text of the app's focused text field through accessibility. This is the Select
 * All an app in the background accepts: its Edit > Select All stays disabled until it is active.
 * False when no native text field has focus.
 */
export function selectAllInFocusedTextElement(pid: number): boolean {
	const element = focusedTextEntryElement(pid);
	if (element === null) {
		return false;
	}
	try {
		const axValue = createCFRangeValue({ location: 0, length: readElementText(element).length });
		try {
			setAttributeValue(element, K_AX_SELECTED_TEXT_RANGE_ATTRIBUTE, axValue);
		} finally {
			cfRelease(axValue);
		}
		return true;
	} finally {
		releaseAXElement(element);
	}
}

/** Replace the focused native text field's selection with `text` (empty deletes it); false when no such field has focus. */
export function replaceSelectionInFocusedTextElement(pid: number, text: string): boolean {
	const element = focusedTextEntryElement(pid);
	if (element === null) {
		return false;
	}
	try {
		const value = toCFString(text);
		try {
			setAttributeValue(element, "AXSelectedText", value);
		} finally {
			cfRelease(value);
		}
		return true;
	} finally {
		releaseAXElement(element);
	}
}

/** The selected text of the app's focused text field, or undefined when no native text field has focus. */
export function selectedTextOfFocusedElement(pid: number): string | undefined {
	const element = focusedTextEntryElement(pid);
	if (element === null) {
		return undefined;
	}
	try {
		const value = copyAttributeValue(element, "AXSelectedText");
		if (value === null) {
			return "";
		}
		try {
			return isCFString(value) ? fromCFString(value) : "";
		} finally {
			cfRelease(value);
		}
	} finally {
		releaseAXElement(element);
	}
}

function readElementText(element: AXUIElementRef): string {
	let value: CFTypeRef | null;
	try {
		value = copyAttributeValue(element, K_AX_VALUE_ATTRIBUTE);
	} catch {
		return "";
	}
	if (value === null) {
		return "";
	}
	try {
		return isCFString(value) ? fromCFString(value) : "";
	} finally {
		cfRelease(value);
	}
}

function createCFRangeValue(range: { readonly location: number; readonly length: number }): CFTypeRef {
	const buffer = Buffer.alloc(CF_RANGE_BYTES);
	buffer.writeBigInt64LE(BigInt(range.location), 0);
	buffer.writeBigInt64LE(BigInt(range.length), CF_RANGE_LENGTH_OFFSET);
	const axValue = AXValueCreate(K_AX_VALUE_CF_RANGE_TYPE, buffer);
	if (axValue === null) {
		throw new Error("AXValueCreate returned null for CFRange");
	}
	return axValue;
}
