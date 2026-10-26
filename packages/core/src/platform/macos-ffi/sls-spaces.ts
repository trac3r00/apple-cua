import type { KoffiFunc } from "koffi";
import {
	type CFTypeRef,
	cfArrayLength,
	cfArrayValueAt,
	cfDictionaryValue,
	cfRelease,
	fromCFNumber,
	fromCFString,
	isCFArray,
	isCFDictionary,
	isCFNumber,
	isCFString,
	withCFString,
} from "./corefoundation.js";
import { koffi } from "./koffi.js";

export type SpaceInfo = {
	readonly id: number;
	readonly type: number;
	readonly uuid?: string;
};

export type ManagedDisplaySpaces = {
	readonly displayIdentifier: string;
	readonly currentSpaceId: number;
	readonly spaces: readonly SpaceInfo[];
};

const skyLight = koffi.load("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight");
const SLSMainConnectionID = skyLight.func("SLSMainConnectionID", "uint32_t", []) as KoffiFunc<() => number>;
const SLSGetActiveSpace = skyLight.func("SLSGetActiveSpace", "uint64_t", ["uint32_t"]) as KoffiFunc<
	(connection: number) => number
>;
const SLSCopyManagedDisplaySpaces = skyLight.func("SLSCopyManagedDisplaySpaces", "void *", ["uint32_t"]) as KoffiFunc<
	(connection: number) => CFTypeRef | null
>;
const SLSSpaceGetType = skyLight.func("SLSSpaceGetType", "uint32_t", ["uint32_t", "uint64_t"]) as KoffiFunc<
	(connection: number, spaceId: number) => number
>;

export function activeSpaceId(): number | undefined {
	try {
		const id = SLSGetActiveSpace(SLSMainConnectionID());
		return Number.isSafeInteger(id) && id > 0 ? id : undefined;
	} catch (error) {
		if (error instanceof Error) {
			return undefined;
		}
		throw error;
	}
}

export function managedDisplaySpaces(): ManagedDisplaySpaces[] {
	let copied: CFTypeRef | null;
	try {
		copied = SLSCopyManagedDisplaySpaces(SLSMainConnectionID());
	} catch (error) {
		if (error instanceof Error) {
			return [];
		}
		throw error;
	}
	if (copied === null) {
		return [];
	}
	try {
		if (!isCFArray(copied)) {
			return [];
		}
		return readManagedDisplays(copied);
	} catch (error) {
		if (error instanceof Error) {
			return [];
		}
		throw error;
	} finally {
		cfRelease(copied);
	}
}

export function spaceTypeFor(spaceId: number): number | undefined {
	if (!Number.isSafeInteger(spaceId) || spaceId <= 0) {
		return undefined;
	}
	try {
		const type = SLSSpaceGetType(SLSMainConnectionID(), spaceId);
		return Number.isSafeInteger(type) ? type : undefined;
	} catch (error) {
		if (error instanceof Error) {
			return undefined;
		}
		throw error;
	}
}

/**
 * Native SLSCopySpacesForWindows is not invoked: the available probe crashed in-process.
 * Retained as a best-effort API until a safe runtime contract is established.
 */
export function spacesForWindows(windowIds: readonly number[]): Map<number, number[]> {
	if (windowIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
		return new Map();
	}
	return parseWindowSpaceResults(windowIds, []);
}

/** Map the native per-window space lists without making the unsafe native call. */
export function parseWindowSpaceResults(
	windowIds: readonly number[],
	spaceIdsByWindow: readonly (readonly number[])[],
): Map<number, number[]> {
	return new Map(
		windowIds.flatMap((windowId, index) => {
			const spaceIds = spaceIdsByWindow[index];
			return spaceIds === undefined ? [] : [[windowId, [...spaceIds]]];
		}),
	);
}

function readManagedDisplays(array: CFTypeRef): ManagedDisplaySpaces[] {
	const displays: ManagedDisplaySpaces[] = [];
	for (let index = 0; index < cfArrayLength(array); index += 1) {
		const reference = cfArrayValueAt(array, index);
		if (reference === null || !isCFDictionary(reference)) {
			continue;
		}
		const identifier = dictionaryString(reference, "Display Identifier");
		const current = dictionaryValue(reference, "Current Space");
		if (identifier === undefined || current === null || !isCFDictionary(current)) {
			continue;
		}
		const currentSpaceId = dictionaryNumber(current, "ManagedSpaceID") ?? dictionaryNumber(current, "id64");
		const spaces = dictionaryValue(reference, "Spaces");
		if (currentSpaceId === undefined || spaces === null || !isCFArray(spaces)) {
			continue;
		}
		displays.push({
			displayIdentifier: identifier,
			currentSpaceId,
			spaces: readSpaces(spaces),
		});
	}
	return displays;
}

function readSpaces(array: CFTypeRef): SpaceInfo[] {
	const spaces: SpaceInfo[] = [];
	for (let index = 0; index < cfArrayLength(array); index += 1) {
		const reference = cfArrayValueAt(array, index);
		if (reference === null || !isCFDictionary(reference)) {
			continue;
		}
		const id = dictionaryNumber(reference, "ManagedSpaceID") ?? dictionaryNumber(reference, "id64");
		const type = dictionaryNumber(reference, "type");
		if (id === undefined || type === undefined) {
			continue;
		}
		const uuid = dictionaryString(reference, "uuid");
		spaces.push(uuid === undefined ? { id, type } : { id, type, uuid });
	}
	return spaces;
}

function dictionaryValue(dictionary: CFTypeRef, key: string): CFTypeRef | null {
	return withCFString(key, (keyReference) => cfDictionaryValue(dictionary, keyReference));
}

function dictionaryNumber(dictionary: CFTypeRef, key: string): number | undefined {
	const value = dictionaryValue(dictionary, key);
	return value !== null && isCFNumber(value) ? fromCFNumber(value) : undefined;
}

function dictionaryString(dictionary: CFTypeRef, key: string): string | undefined {
	const value = dictionaryValue(dictionary, key);
	return value !== null && isCFString(value) ? fromCFString(value) : undefined;
}
