import { stableElementKey } from "./stable-element-key.js";
import type { AXTreeElement, AxTreeChangeSummary } from "./types.js";

export type { AxTreeChangeSummary };

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
