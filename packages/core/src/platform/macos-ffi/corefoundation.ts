import type { KoffiFunc } from "koffi";
import { koffi } from "./koffi.js";

export type CFTypeRef = object;
export type CFStringRef = CFTypeRef;
export type CFArrayRef = CFTypeRef;

const CF_STRING_ENCODING_UTF8 = 0x08000100;

const coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
const CF_TYPE_REF = koffi.pointer("CFTypeRef", koffi.opaque());
const CF_STRING_REF = koffi.pointer("CFStringRef", koffi.opaque());
const CF_ARRAY_REF = koffi.pointer("CFArrayRef", koffi.opaque());
const CF_TYPE_REF_POINTER = koffi.pointer(CF_TYPE_REF);

const CFStringCreateWithCString = coreFoundation.func("CFStringCreateWithCString", CF_STRING_REF, [
	"void *",
	"string",
	"uint32_t",
]) as KoffiFunc<(allocator: null, value: string, encoding: number) => CFStringRef | null>;

const CFStringGetLength = coreFoundation.func("CFStringGetLength", "long", [CF_STRING_REF]) as KoffiFunc<
	(reference: CFStringRef) => number
>;

const CFStringGetMaximumSizeForEncoding = coreFoundation.func("CFStringGetMaximumSizeForEncoding", "long", [
	"long",
	"uint32_t",
]) as KoffiFunc<(length: number, encoding: number) => number>;

const CFStringGetCString = coreFoundation.func("CFStringGetCString", "bool", [
	CF_STRING_REF,
	"char *",
	"long",
	"uint32_t",
]) as KoffiFunc<(reference: CFStringRef, buffer: Buffer, bufferSize: number, encoding: number) => boolean>;

const CFArrayCreate = coreFoundation.func("CFArrayCreate", CF_ARRAY_REF, [
	"void *",
	CF_TYPE_REF_POINTER,
	"long",
	"void *",
]) as KoffiFunc<
	(allocator: null, values: readonly CFTypeRef[] | null, valueCount: number, callbacks: null) => CFArrayRef | null
>;

const CFReleaseNative = coreFoundation.func("CFRelease", "void", ["void *"]) as KoffiFunc<
	(reference: CFTypeRef) => void
>;

export function cfRelease(reference: CFTypeRef | null): void {
	if (reference !== null) {
		CFReleaseNative(reference);
	}
}

export function toCFString(value: string): CFStringRef {
	const reference = CFStringCreateWithCString(null, value, CF_STRING_ENCODING_UTF8);
	if (reference === null) {
		throw new Error("CFStringCreateWithCString returned null");
	}
	return reference;
}

export function fromCFString(reference: CFStringRef): string {
	const length = CFStringGetLength(reference);
	const maximumSize = CFStringGetMaximumSizeForEncoding(length, CF_STRING_ENCODING_UTF8);
	if (maximumSize < 0) {
		throw new Error("CFStringGetMaximumSizeForEncoding returned a negative length");
	}

	const buffer = Buffer.alloc(maximumSize + 1);
	const didCopy = CFStringGetCString(reference, buffer, buffer.byteLength, CF_STRING_ENCODING_UTF8);
	if (!didCopy) {
		throw new Error("CFStringGetCString failed");
	}

	const endIndex = buffer.indexOf(0);
	return buffer.subarray(0, endIndex === -1 ? buffer.byteLength : endIndex).toString("utf8");
}

export function withCFString<TResult>(value: string, callback: (reference: CFStringRef) => TResult): TResult {
	const reference = toCFString(value);
	try {
		return callback(reference);
	} finally {
		cfRelease(reference);
	}
}

export function withCFArray<TResult>(
	values: readonly CFTypeRef[],
	callback: (reference: CFArrayRef) => TResult,
): TResult {
	const reference = CFArrayCreate(null, values.length === 0 ? null : values, values.length, null);
	if (reference === null) {
		throw new Error("CFArrayCreate returned null");
	}

	try {
		return callback(reference);
	} finally {
		cfRelease(reference);
	}
}
