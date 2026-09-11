import { stableElementKey } from "./stable-element-key.js";
import type { AXTreeElement, AxTreeChangeSummary, AxTreeChanges } from "./types.js";

export type { AxTreeChangeSummary, AxTreeChanges };

export function diffAxTreesByKey(
	previous: readonly AXTreeElement[],
	current: readonly AXTreeElement[],
): AxTreeChangeSummary {
	const previousByKey = new Map(previous.map((element) => [stableElementKey(element), element]));
	const currentByKey = new Map(current.map((element) => [stableElementKey(element), element]));
	let added = 0;
	let changed = 0;
	for (const [key, element] of currentByKey) {
		const prior = previousByKey.get(key);
		if (prior === undefined) {
			added += 1;
		} else if ((prior.value ?? "") !== (element.value ?? "")) {
			changed += 1;
		}
	}
	let removed = 0;
	for (const key of previousByKey.keys()) {
		if (!currentByKey.has(key)) {
			removed += 1;
		}
	}
	return { added, removed, changed };
}

/**
 * Diff two accessibility snapshots into the actual elements that were added,
 * removed, and changed, matched by content identity ({@link stableElementKey})
 * rather than positional id so reordered/renumbered trees do not produce
 * spurious changes. This is the element-level counterpart of
 * {@link diffAxTreesByKey}: the token-efficient observation the model reads to
 * see *what* changed, not just *how much*.
 */
export function diffAxTreeChanges(
	previous: readonly AXTreeElement[],
	current: readonly AXTreeElement[],
): AxTreeChanges {
	const previousByKey = new Map(previous.map((element) => [stableElementKey(element), element]));
	const currentByKey = new Map(current.map((element) => [stableElementKey(element), element]));
	const added: AXTreeElement[] = [];
	const changed: Array<{ before: AXTreeElement; after: AXTreeElement }> = [];
	for (const [key, element] of currentByKey) {
		const prior = previousByKey.get(key);
		if (prior === undefined) {
			added.push(element);
		} else if ((prior.value ?? "") !== (element.value ?? "")) {
			changed.push({ before: prior, after: element });
		}
	}
	const removed: AXTreeElement[] = [];
	for (const [key, element] of previousByKey) {
		if (!currentByKey.has(key)) {
			removed.push(element);
		}
	}
	return { added, removed, changed };
}

export function diffAxTrees(
	previous: readonly AXTreeElement[],
	current: readonly AXTreeElement[],
): AxTreeChangeSummary {
	const previousById = new Map(previous.map((element) => [element.id, element]));
	const currentById = new Map(current.map((element) => [element.id, element]));
	let added = 0;
	let changed = 0;
	for (const element of current) {
		const prior = previousById.get(element.id);
		if (prior === undefined) {
			added += 1;
		} else if (elementSignature(prior) !== elementSignature(element)) {
			changed += 1;
		}
	}
	let removed = 0;
	for (const element of previous) {
		if (!currentById.has(element.id)) {
			removed += 1;
		}
	}
	return { added, removed, changed };
}

function elementSignature(element: AXTreeElement): string {
	const frame = `${element.frame.x},${element.frame.y},${element.frame.width},${element.frame.height}`;
	return [element.role, element.label ?? "", element.value ?? "", frame].join("|");
}
