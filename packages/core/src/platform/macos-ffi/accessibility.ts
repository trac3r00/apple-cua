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
	isCFArray,
	isCFBoolean,
	isCFNull,
	isCFNumber,
	isCFString,
	toCFString,
	withCFArray,
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

interface AXElementSnapshot {
	readonly maxDepth: number;
	readonly maxElements: number;
	readonly scope: AXWalkScope;
	readonly elements: readonly AXUIElementRef[];
}

/**
 * Which part of the application tree a walk covered. Element ids are ordinals of one
 * exact traversal, so any later re-walk (refetching an element for an action) has to
 * repeat the same traversal or the ids would silently mean different controls.
 */
interface AXWalkScope {
	readonly windowId: number | undefined;
	readonly includeMenuBar: boolean;
	readonly scoped: boolean;
}

const UNMATCHED_WINDOW_SCOPE: AXWalkScope = { windowId: undefined, includeMenuBar: true, scoped: false };

function walkKeyFor(scope: AXWalkScope, maxDepth: number, maxElements: number): string {
	return JSON.stringify([scope.scoped, scope.windowId ?? null, scope.includeMenuBar, maxDepth, maxElements]);
}

function unavailableWalkKey(maxDepth: number, maxElements: number): string {
	return `unavailable|${maxDepth}|${maxElements}`;
}

/** Roles that cannot carry an action, so their action list is not worth an extra AX round trip. */
const NON_ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
	"AXApplication",
	"AXGroup",
	"AXImage",
	"AXLayoutArea",
	"AXLayoutItem",
	"AXMenu",
	"AXMenuBar",
	"AXScrollArea",
	"AXSplitter",
	"AXStaticText",
	"AXUnknown",
	"AXWindow",
]);

/** Attributes read in a single AX round trip per element, children included so the walk
 * does not spend a second round trip discovering them. */
const ELEMENT_FACT_ATTRIBUTES = [
	K_AX_ROLE_ATTRIBUTE,
	K_AX_TITLE_ATTRIBUTE,
	K_AX_DESCRIPTION_ATTRIBUTE,
	K_AX_VALUE_ATTRIBUTE,
	K_AX_POSITION_ATTRIBUTE,
	K_AX_SIZE_ATTRIBUTE,
	K_AX_CHILDREN_ATTRIBUTE,
] as const;

interface AXElementFacts {
	readonly role: string;
	readonly label: string | null;
	readonly value: string | null;
	readonly frame: AXTreeElement["frame"];
	/** Retained child elements; the caller releases each one. */
	readonly children: readonly AXUIElementRef[];
}

const elementSnapshots = new Map<number, AXElementSnapshot>();

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

const AXUIElementCopyMultipleAttributeValues = applicationServices.func(
	"int32_t AXUIElementCopyMultipleAttributeValues(void *element, void *attributes, uint32_t options, _Out_ void **values)",
) as KoffiFunc<
	(element: AXUIElementRef, attributes: CFArrayRef, options: number, values: Array<CFArrayRef | null>) => number
>;

/**
 * Private SPI that maps an AX window element to its CGWindowID, the same one the
 * reference driver uses. Optional: when it is unavailable the walk keeps working
 * unscoped instead of guessing which AX window matches a WindowServer window.
 */
const AXUIElementGetWindowSpi = (() => {
	try {
		return applicationServices.func(
			"int32_t _AXUIElementGetWindow(void *element, _Out_ uint32_t *windowId)",
		) as KoffiFunc<(element: AXUIElementRef, windowId: Uint32Array) => number>;
	} catch {
		return null;
	}
})();

export interface AccessibilityTreeResult {
	readonly elements: AXTreeElement[];
	readonly axAvailable: boolean;
	/** True when the walk stopped at the element budget, so the tree is a partial view. */
	readonly truncated: boolean;
	/**
	 * Identifies the exact traversal that produced these element ids. Two walks are only
	 * comparable (same ids, same coverage) when their keys match, so diffs must not cross
	 * keys.
	 */
	readonly walkKey: string;
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

const K_AX_FOCUSED_WINDOW_ATTRIBUTE = "AXFocusedWindow";

/**
 * WindowServer id of the window the app currently considers focused, the same window the
 * user sees, so a multi-window app is not resolved by an arbitrary window order. Returns
 * undefined when the app has no focused window or the private SPI is unavailable.
 */
export function focusedWindowIdForPid(pid: number): number | undefined {
	if (!isRunning(pid) || AXUIElementGetWindowSpi === null) {
		return undefined;
	}
	let root: AXUIElementRef | null = null;
	let focused: CFTypeRef | null = null;
	try {
		root = createApplicationElement(pid);
		focused = copyOptionalAttributeValue(root, K_AX_FOCUSED_WINDOW_ATTRIBUTE);
		if (focused === null || !cfGetTypeId(focused)) {
			return undefined;
		}
		return windowIdOf(focused as AXUIElementRef);
	} catch {
		return undefined;
	} finally {
		if (focused !== null) {
			cfRelease(focused);
		}
		if (root !== null) {
			releaseAXElement(root);
		}
	}
}

export function releaseAccessibilitySnapshot(pid: number): void {
	replaceElementSnapshot(pid, undefined);
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

export interface AccessibilityTreeOptions {
	/** Maximum tree depth to walk. */
	readonly maxDepth?: number;
	readonly maxElements?: number;
	/**
	 * Scope the walk to one window. When the WindowServer window maps to an AX window,
	 * only that window plus the app's non-window top-level children (sheets, panels) are
	 * walked, which is what an observation of one app window actually needs. When the id
	 * cannot be matched the walk falls back to the whole application tree.
	 */
	readonly windowId?: number | undefined;
	/** Include the menu bar, which is app-level rather than window content. Default false. */
	readonly includeMenuBar?: boolean;
}

export function extractAccessibilityTree(pid: number, options: AccessibilityTreeOptions = {}): AccessibilityTreeResult {
	const maxDepth = options.maxDepth ?? DEFAULT_AX_MAX_DEPTH;
	const maxElements = options.maxElements ?? DEFAULT_AX_MAX_ELEMENTS;
	if (!AXIsProcessTrusted() || !isRunning(pid) || maxDepth < 0 || maxElements <= 0) {
		replaceElementSnapshot(pid, undefined);
		return { elements: [], axAvailable: false, truncated: false, walkKey: unavailableWalkKey(maxDepth, maxElements) };
	}

	const root = createApplicationElement(pid);
	const walkRoots: AXUIElementRef[] = [];
	const snapshotElements: AXUIElementRef[] = [];
	try {
		const scope = resolveWalkScope(root, options);
		walkRoots.push(...scope.roots);
		if (scope.appChildren === 0) {
			replaceElementSnapshot(pid, undefined);
			return {
				elements: [],
				axAvailable: false,
				truncated: false,
				walkKey: unavailableWalkKey(maxDepth, maxElements),
			};
		}

		const elements: AXTreeElement[] = [];
		// An unscoped walk starts at the application element, whose recursion covers its
		// children, and produces exactly the order this driver has always produced. A scoped
		// walk starts at the matched window because the application element is not part of
		// a window observation.
		const walkInputs = scope.scoped ? scope.roots : [root];
		walkElements(walkInputs, maxDepth, maxElements, elements, snapshotElements);
		if (elements.length === 0) {
			replaceElementSnapshot(pid, undefined);
			return {
				elements: [],
				axAvailable: false,
				truncated: false,
				walkKey: unavailableWalkKey(maxDepth, maxElements),
			};
		}
		replaceElementSnapshot(pid, { maxDepth, maxElements, scope: scope.descriptor, elements: snapshotElements });
		return {
			elements,
			axAvailable: true,
			truncated: elements.length >= maxElements,
			walkKey: walkKeyFor(scope.descriptor, maxDepth, maxElements),
		};
	} catch (error) {
		for (const element of snapshotElements) {
			releaseAXElement(element);
		}
		throw error;
	} finally {
		for (const element of walkRoots) {
			releaseAXElement(element);
		}
		releaseAXElement(root);
	}
}

const DEFAULT_AX_MAX_DEPTH = 10;
const DEFAULT_AX_MAX_ELEMENTS = 2_000;

interface ResolvedWalkScope {
	/** Top-level elements to walk, excluding the application element itself. Caller releases them. */
	readonly roots: readonly AXUIElementRef[];
	readonly descriptor: AXWalkScope;
	readonly scoped: boolean;
	/** Number of direct children the application element exposes, before any scoping. */
	readonly appChildren: number;
}

/**
 * Decide what to walk. The scoped case walks the matched AX window first and then the
 * app's non-window top-level children (sheets, panels, popovers), because those are
 * visible content of the observation; other windows and the menu bar are not. Any
 * failure to match the requested window returns the full, unscoped application walk.
 */
function resolveWalkScope(root: AXUIElementRef, options: AccessibilityTreeOptions): ResolvedWalkScope {
	const children = copyElementChildren(root);
	const appChildren = children.length;
	const includeMenuBar = options.includeMenuBar === true;
	const windowId = options.windowId;
	if (windowId === undefined || AXUIElementGetWindowSpi === null) {
		return { roots: children, descriptor: UNMATCHED_WINDOW_SCOPE, scoped: false, appChildren };
	}

	const windows: AXUIElementRef[] = [];
	const attached: AXUIElementRef[] = [];
	for (const child of children) {
		const matched = windowIdOf(child) === windowId;
		if (matched) {
			windows.push(child);
			continue;
		}
		if (isAppLevelChrome(child, includeMenuBar)) {
			releaseAXElement(child);
			continue;
		}
		attached.push(child);
	}

	if (windows.length === 0) {
		for (const child of attached) {
			releaseAXElement(child);
		}
		return { roots: children, descriptor: UNMATCHED_WINDOW_SCOPE, scoped: false, appChildren };
	}

	return {
		roots: [...windows, ...attached],
		descriptor: { windowId, includeMenuBar, scoped: true },
		scoped: true,
		appChildren,
	};
}

function windowIdOf(element: AXUIElementRef): number | undefined {
	if (AXUIElementGetWindowSpi === null) {
		return undefined;
	}
	const out = new Uint32Array(1);
	return AXUIElementGetWindowSpi(element, out) === AX_SUCCESS ? out[0] : undefined;
}

function isAppLevelChrome(element: AXUIElementRef, includeMenuBar: boolean): boolean {
	const role = copyStringAttribute(element, K_AX_ROLE_ATTRIBUTE) ?? "";
	if (role === "AXWindow" || role === "AXSheet" || role === "AXDialog") {
		return true;
	}
	if (includeMenuBar) {
		return false;
	}
	return role === "AXMenuBar" || role === "AXMenu" || role === "AXMenuBarItem" || role === "AXMenuItem";
}

function walkElements(
	roots: readonly AXUIElementRef[],
	maxDepth: number,
	maxElements: number,
	elements: AXTreeElement[],
	snapshotElements: AXUIElementRef[],
): void {
	const state: WalkState = { useMultipleAttributes: true };
	for (const root of roots) {
		if (elements.length >= maxElements) {
			return;
		}
		appendAXElement(root, 0, maxDepth, maxElements, elements, snapshotElements, state);
	}
}

interface WalkState {
	useMultipleAttributes: boolean;
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

export function refetchElement(
	pid: number,
	elementIndex: number,
	maxDepth = DEFAULT_AX_MAX_DEPTH,
	maxElements = DEFAULT_AX_MAX_ELEMENTS,
): AXUIElementRef {
	if (!AXIsProcessTrusted()) {
		replaceElementSnapshot(pid, undefined);
		throw new Error("accessibility permission denied");
	}
	if (!isRunning(pid)) {
		replaceElementSnapshot(pid, undefined);
		throw new Error(`invalid process or element index: ${pid}:${elementIndex}`);
	}
	if (elementIndex < 0 || elementIndex >= maxElements) {
		throw new Error(`invalid process or element index: ${pid}:${elementIndex}`);
	}

	const snapshot = elementSnapshots.get(pid);
	if (snapshot?.maxDepth === maxDepth && snapshot.maxElements === maxElements) {
		const cached = snapshot.elements[elementIndex];
		if (cached === undefined) {
			throw new Error(`element ${elementIndex} not found in snapshot`);
		}
		return cfRetain(cached);
	}

	const root = createApplicationElement(pid);
	const walkRoots: AXUIElementRef[] = [];
	try {
		const scope: AXWalkScope = snapshot?.scope ?? UNMATCHED_WINDOW_SCOPE;
		const resolved = resolveWalkScope(root, {
			windowId: scope.windowId,
			includeMenuBar: scope.includeMenuBar,
		});
		walkRoots.push(...resolved.roots);
		const walkInputs = resolved.scoped ? resolved.roots : [root];
		const cursor = { value: 0 };
		for (const walkInput of walkInputs) {
			const matched = findAXElement(walkInput, elementIndex, 0, maxDepth, maxElements, cursor);
			if (matched !== null) {
				return matched;
			}
		}
		throw new Error(`element ${elementIndex} not found`);
	} finally {
		for (const element of walkRoots) {
			releaseAXElement(element);
		}
		releaseAXElement(root);
	}
}

function appendAXElement(
	element: AXUIElementRef,
	depth: number,
	maxDepth: number,
	maxElements: number,
	elements: AXTreeElement[],
	snapshotElements: AXUIElementRef[],
	state: WalkState,
): number | undefined {
	if (depth > maxDepth || elements.length >= maxElements) {
		return undefined;
	}

	const id = elements.length;
	snapshotElements.push(cfRetain(element));
	const facts = copyElementFacts(element, state);
	elements.push({
		id,
		role: facts.role,
		label: facts.label,
		value: facts.value,
		frame: facts.frame,
		actions: copyActionsForRole(element, facts.role),
		children: [],
	});

	const childIds: number[] = [];
	if (depth < maxDepth) {
		const children = facts.children;
		try {
			for (const child of children) {
				if (elements.length >= maxElements) {
					break;
				}
				const childId = appendAXElement(child, depth + 1, maxDepth, maxElements, elements, snapshotElements, state);
				if (childId !== undefined) {
					childIds.push(childId);
				}
			}
		} finally {
			for (const child of children) {
				releaseAXElement(child);
			}
		}
	} else {
		for (const child of facts.children) {
			releaseAXElement(child);
		}
	}

	const current = elements[id];
	if (current === undefined) {
		throw new Error(`AX tree cursor lost element ${id}`);
	}
	elements[id] = { ...current, children: childIds };
	return id;
}

/**
 * Read every fact about one element in as few AX round trips as possible.
 *
 * `AXUIElementCopyMultipleAttributeValues` returns the requested attributes in one
 * round trip (measured ~5x cheaper than six single reads), which dominates walk cost
 * for large applications. If it fails once, the walk keeps going on the single-read
 * path so unsupported applications still produce a tree.
 */
function copyElementFacts(element: AXUIElementRef, state: WalkState): AXElementFacts {
	if (!state.useMultipleAttributes) {
		return copyElementFactsOneByOne(element);
	}

	const attributeReferences = ELEMENT_FACT_ATTRIBUTES.map((attribute) => toCFString(attribute));
	let facts: AXElementFacts | undefined;
	try {
		facts = withCFArray(attributeReferences, (attributes) => {
			const outValues: Array<CFArrayRef | null> = [null];
			const error = AXUIElementCopyMultipleAttributeValues(element, attributes, 0, outValues);
			const values = outValues[0];
			if (error !== AX_SUCCESS || values === undefined || values === null) {
				return undefined;
			}
			try {
				return factsFromValues(values);
			} finally {
				cfRelease(values);
			}
		});
	} finally {
		for (const reference of attributeReferences) {
			cfRelease(reference);
		}
	}

	if (facts === undefined) {
		state.useMultipleAttributes = false;
		return copyElementFactsOneByOne(element);
	}
	return facts;
}

function copyElementFactsOneByOne(element: AXUIElementRef): AXElementFacts {
	const label =
		copyStringAttribute(element, K_AX_TITLE_ATTRIBUTE) ?? copyStringAttribute(element, K_AX_DESCRIPTION_ATTRIBUTE);
	return {
		role: copyStringAttribute(element, K_AX_ROLE_ATTRIBUTE) ?? "",
		label,
		value: copyStringValueAttribute(element),
		frame: copyFrame(element),
		children: copyElementChildren(element),
	};
}

function factsFromValues(values: CFArrayRef): AXElementFacts {
	const valueAt = (index: number): CFTypeRef | null => {
		if (index >= cfArrayLength(values)) {
			return null;
		}
		const value = cfArrayValueAt(values, index);
		return value === null || isCFNull(value) ? null : value;
	};

	const title = stringOrNull(valueAt(1));
	const descriptionValue = title === null ? stringOrNull(valueAt(2)) : null;
	return {
		role: stringOrNull(valueAt(0)) ?? "",
		label: title ?? descriptionValue,
		value: stringOrNull(valueAt(3)),
		frame: {
			...(pointFromValue(valueAt(4)) ?? { x: 0, y: 0 }),
			...(sizeFromValue(valueAt(5)) ?? { width: 0, height: 0 }),
		},
		children: childrenFromValue(valueAt(6)),
	};
}

function childrenFromValue(value: CFTypeRef | null): AXUIElementRef[] {
	if (value === null) {
		return [];
	}
	// Some applications hand back a single element instead of an array for AXChildren.
	if (cfGetTypeId(value) === AXUIElementGetTypeID()) {
		return [cfRetain(value)];
	}
	if (!isCFArray(value)) {
		return [];
	}
	const children: AXUIElementRef[] = [];
	for (let index = 0; index < cfArrayLength(value); index += 1) {
		const child = cfArrayValueAt(value, index);
		if (child !== null && cfGetTypeId(child) === AXUIElementGetTypeID()) {
			children.push(cfRetain(child));
		}
	}
	return children;
}

function stringOrNull(value: CFTypeRef | null): string | null {
	return value === null ? null : stringFromValue(value);
}

/** Roles that cannot act do not need their action list fetched over AX. */
function copyActionsForRole(element: AXUIElementRef, role: string): string[] {
	return NON_ACTIONABLE_ROLES.has(role) ? [] : copyActionNames(element);
}

function replaceElementSnapshot(pid: number, snapshot: AXElementSnapshot | undefined): void {
	const previous = elementSnapshots.get(pid);
	if (previous !== undefined) {
		for (const element of previous.elements) {
			releaseAXElement(element);
		}
	}
	if (snapshot === undefined) {
		elementSnapshots.delete(pid);
	} else {
		elementSnapshots.set(pid, snapshot);
	}
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
		return pointFromValue(value);
	} finally {
		cfRelease(value);
	}
}

function pointFromValue(value: CFTypeRef | null): { x: number; y: number } | null {
	if (value === null || !isAXValue(value) || AXValueGetType(value) !== AX_VALUE_CG_POINT) {
		return null;
	}
	const buffer = Buffer.alloc(CG_PAIR_SIZE);
	if (!AXValueGetValue(value, AX_VALUE_CG_POINT, buffer)) {
		return null;
	}
	return { x: buffer.readDoubleLE(0), y: buffer.readDoubleLE(DOUBLE_SIZE) };
}

function copySizeAttribute(element: AXUIElementRef, attribute: string): { width: number; height: number } | null {
	const value = copyOptionalAttributeValue(element, attribute);
	if (value === null) {
		return null;
	}
	try {
		return sizeFromValue(value);
	} finally {
		cfRelease(value);
	}
}

function sizeFromValue(value: CFTypeRef | null): { width: number; height: number } | null {
	if (value === null || !isAXValue(value) || AXValueGetType(value) !== AX_VALUE_CG_SIZE) {
		return null;
	}
	const buffer = Buffer.alloc(CG_PAIR_SIZE);
	if (!AXValueGetValue(value, AX_VALUE_CG_SIZE, buffer)) {
		return null;
	}
	return { width: buffer.readDoubleLE(0), height: buffer.readDoubleLE(DOUBLE_SIZE) };
}

function copyElementChildren(element: AXUIElementRef): AXUIElementRef[] {
	const value = copyOptionalAttributeValue(element, K_AX_CHILDREN_ATTRIBUTE);
	if (value === null) {
		return [];
	}
	try {
		return childrenFromValue(value);
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
