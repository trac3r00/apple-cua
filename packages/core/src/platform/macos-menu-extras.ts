import type { AXTreeElement } from "../accessibility/types.js";
import {
	copyOptionalAttributeValue,
	currentObservationKey,
	extractAccessibilityTree,
	performActionByIndex,
	refetchElement,
	releaseAXElement,
} from "./macos-ffi/accessibility.js";
import { cfRelease, fromCFBoolean, isCFBoolean } from "./macos-ffi/corefoundation.js";
import { findRunningApplication } from "./macos-ffi/workspace.js";

const CONTROL_CENTER_BUNDLE_ID = "com.apple.controlcenter";
const MENU_EXTRA_ROLES = new Set(["AXMenuBarItem", "AXStatusBarItem"]);

export interface MenuExtraSnapshot {
	readonly pid: number;
	readonly observationKey: string;
	readonly items: readonly AXTreeElement[];
	readonly truncated: boolean;
}

interface NativeMenuExtrasAccess {
	findControlCenter(): number | undefined;
	extract(
		pid: number,
		signatureOnly: boolean,
	): {
		readonly elements: readonly AXTreeElement[];
		readonly truncated: boolean;
	};
	observationKey(pid: number): string | undefined;
	enabled(pid: number, id: number): boolean | null;
	perform(pid: number, id: number, action: string): void;
}

const nativeAccess: NativeMenuExtrasAccess = {
	findControlCenter: () => {
		const app = findRunningApplication(CONTROL_CENTER_BUNDLE_ID);
		return app?.bundleId === CONTROL_CENTER_BUNDLE_ID ? app.pid : undefined;
	},
	extract: (pid, signatureOnly) => extractAccessibilityTree(pid, { signatureOnly }),
	observationKey: currentObservationKey,
	enabled: (pid, id) => {
		const element = refetchElement(pid, id);
		try {
			const value = copyOptionalAttributeValue(element, "AXEnabled");
			if (value === null) return null;
			try {
				return isCFBoolean(value) ? fromCFBoolean(value) : null;
			} finally {
				cfRelease(value);
			}
		} finally {
			releaseAXElement(element);
		}
	},
	perform: performActionByIndex,
};

/** Injected native access keeps listing and action checks deterministic in tests. */
export function createNativeMenuExtrasSource(access: NativeMenuExtrasAccess = nativeAccess) {
	let latest: MenuExtraSnapshot | undefined;

	return {
		async read(): Promise<MenuExtraSnapshot> {
			const pid = access.findControlCenter();
			if (pid === undefined) throw new Error("Control Center process is not running");
			const tree = access.extract(pid, false);
			const observationKey = access.observationKey(pid);
			if (observationKey === undefined) throw new Error("Control Center observation key is unavailable");
			const items = tree.elements.filter(
				(element) => MENU_EXTRA_ROLES.has(element.role) && element.actions.includes("AXPress"),
			);
			const snapshot = { pid, observationKey, items, truncated: tree.truncated };
			latest = snapshot;
			return snapshot;
		},

		async act(snapshot: MenuExtraSnapshot, elementId: number): Promise<void> {
			if (latest !== snapshot) throw new Error("Menu extras snapshot is stale or was not observed by this source");
			if (access.findControlCenter() !== snapshot.pid) {
				throw new Error("Control Center process changed since observation");
			}
			const observedMatches = snapshot.items.filter((element) => element.id === elementId);
			if (observedMatches.length !== 1) throw new Error("Control Center item is absent or ambiguous");
			const observed = observedMatches[0];
			if (observed === undefined || !MENU_EXTRA_ROLES.has(observed.role)) {
				throw new Error("Actions are limited to observed menu extras");
			}
			if (!observed.actions.includes("AXPress")) throw new Error("Menu extra does not advertise AXPress");
			if (access.observationKey(snapshot.pid) !== snapshot.observationKey) {
				throw new Error("Control Center observation changed since read");
			}
			const live = access.extract(snapshot.pid, true);
			if (access.observationKey(snapshot.pid) !== snapshot.observationKey) {
				throw new Error("Control Center observation changed since read");
			}
			const currentMatches = live.elements.filter((element) => element.id === elementId);
			const current = currentMatches[0];
			if (
				currentMatches.length !== 1 ||
				current === undefined ||
				current.role !== observed.role ||
				current.label !== observed.label ||
				current.value !== observed.value ||
				!current.actions.includes("AXPress")
			) {
				throw new Error("Menu extra no longer matches the observed control or action");
			}
			if (access.enabled(snapshot.pid, elementId) === false) throw new Error("Menu extra is disabled");
			access.perform(snapshot.pid, elementId, "AXPress");
		},
	};
}

const nativeSource = createNativeMenuExtrasSource();
let latestNativeSnapshot: MenuExtraSnapshot | undefined;

/** Read the current Control Center menu-extra controls and their native element ids. */
export async function listMenuExtras(): Promise<{
	readonly pid: number;
	readonly items: readonly {
		readonly id: number;
		readonly role: string;
		readonly label: string | null;
		readonly frame: AXTreeElement["frame"];
	}[];
}> {
	const snapshot = await nativeSource.read();
	latestNativeSnapshot = snapshot;
	return {
		pid: snapshot.pid,
		items: snapshot.items.map(({ id, role, label, frame }) => ({ id, role, label, frame })),
	};
}

/** Press an observed menu extra after confirming its native element id in the latest tree. */
export async function pressExtra(pid: number, elementId: number): Promise<void> {
	const snapshot = latestNativeSnapshot;
	if (snapshot === undefined || snapshot.pid !== pid) {
		throw new Error("Control Center menu extra has not been observed for this process");
	}
	await nativeSource.act(snapshot, elementId);
}
