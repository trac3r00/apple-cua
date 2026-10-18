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

const DOCK_BUNDLE_ID = "com.apple.dock";
const DOCK_ACTIONS = new Set(["AXPress", "AXShowMenu", "AXCancel"]);
const DOCK_ITEM_ROLES = new Set(["AXDockItem", "AXMenuItem"]);

export interface DockSnapshot {
	readonly pid: number;
	readonly observationKey: string;
	readonly elements: readonly AXTreeElement[];
	readonly truncated: boolean;
}

export type DockAction = "AXPress" | "AXShowMenu" | "AXCancel";

export interface DockSource {
	read(): Promise<DockSnapshot>;
	act(snapshot: DockSnapshot, elementId: number, action: DockAction): Promise<void>;
}

interface NativeDockAccess {
	findDock(): number | undefined;
	extract(
		pid: number,
		signatureOnly: boolean,
	): { readonly elements: readonly AXTreeElement[]; readonly truncated: boolean };
	observationKey(pid: number): string | undefined;
	enabled(pid: number, id: number): boolean | null;
	perform(pid: number, id: number, action: DockAction): void;
}

const nativeDockAccess: NativeDockAccess = {
	findDock: () => {
		const dock = findRunningApplication(DOCK_BUNDLE_ID);
		return dock?.bundleId === DOCK_BUNDLE_ID ? dock.pid : undefined;
	},
	extract: (pid, signatureOnly) => extractAccessibilityTree(pid, { signatureOnly }),
	observationKey: currentObservationKey,
	enabled: (pid, id) => {
		const element = refetchElement(pid, id);
		try {
			const value = copyOptionalAttributeValue(element, "AXEnabled");
			if (value === null) {
				return null;
			}
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

/** Native AX access is injected only by the module's deterministic tests. */
export function createNativeDockSource(access: NativeDockAccess = nativeDockAccess): DockSource {
	let latest: DockSnapshot | undefined;

	return {
		async read(): Promise<DockSnapshot> {
			const pid = access.findDock();
			if (pid === undefined) {
				throw new Error("Dock process is not running");
			}
			const tree = access.extract(pid, false);
			const observationKey = access.observationKey(pid);
			if (observationKey === undefined) {
				throw new Error("Dock accessibility observation key is unavailable");
			}
			const elements = tree.elements.filter((element) => DOCK_ITEM_ROLES.has(element.role));
			const snapshot: DockSnapshot = { pid, observationKey, elements, truncated: tree.truncated };
			latest = snapshot;
			return snapshot;
		},

		async act(snapshot, elementId, action): Promise<void> {
			if (!DOCK_ACTIONS.has(action)) {
				throw new Error(`Unsupported Dock action: ${action}`);
			}
			if (latest === undefined || latest !== snapshot) {
				throw new Error("Dock snapshot is stale or was not observed by this source");
			}
			const pid = access.findDock();
			if (pid === undefined || pid !== snapshot.pid) {
				throw new Error("Dock process changed since observation");
			}
			const observedMatches = snapshot.elements.filter((element) => element.id === elementId);
			if (observedMatches.length !== 1) {
				throw new Error("Dock element is absent or ambiguous in the observed snapshot");
			}
			const observed = observedMatches[0];
			if (observed === undefined || !DOCK_ITEM_ROLES.has(observed.role)) {
				throw new Error("Dock actions are limited to observed Dock and menu items");
			}
			if (observed.actions.includes(action) === false) {
				throw new Error(`Dock element does not advertise ${action}`);
			}
			if (access.observationKey(snapshot.pid) !== snapshot.observationKey) {
				throw new Error("Dock accessibility observation changed since read");
			}
			const live = access.extract(snapshot.pid, true);
			const liveKey = access.observationKey(snapshot.pid);
			if (liveKey !== snapshot.observationKey) {
				throw new Error("Dock accessibility observation changed since read");
			}
			const liveMatches = live.elements.filter((element) => element.id === elementId);
			if (liveMatches.length !== 1) {
				throw new Error("Dock control is absent or ambiguous in the current accessibility tree");
			}
			const current = liveMatches[0];
			if (
				current === undefined ||
				!DOCK_ITEM_ROLES.has(current.role) ||
				current.role !== observed.role ||
				current.label !== observed.label ||
				current.value !== observed.value ||
				!current.actions.includes(action)
			) {
				throw new Error("Dock control no longer matches the observed control or action");
			}
			if (access.enabled(snapshot.pid, elementId) === false) {
				throw new Error("Dock control is disabled");
			}
			access.perform(snapshot.pid, elementId, action);
		},
	};
}
