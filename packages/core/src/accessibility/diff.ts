import { stableElementKey } from "./stable-element-key.js";
import type { AXTreeElement, AxTreeChangeSummary, AxTreeChanges } from "./types.js";

export type { AxTreeChangeSummary, AxTreeChanges };

export function diffAxTreesByKey(
	previous: readonly AXTreeElement[],
	current: readonly AXTreeElement[],
): AxTreeChangeSummary {
	const before = groupByKey(previous);
	const after = groupByKey(current);
	let added = 0;
	let changed = 0;
	for (const [key, group] of after) {
		const prior = before.get(key) ?? [];
		added += Math.max(0, group.length - prior.length);
		changed += countValueChanges(prior, group);
	}
	let removed = 0;
	for (const [key, group] of before) {
		removed += Math.max(0, group.length - (after.get(key)?.length ?? 0));
	}
	return { added, removed, changed };
}

/**
 * Elements sharing one content key are compared as a multiset: a second row that looks like
 * an existing one is an addition, and a row that disappears is a removal, instead of both
 * collapsing into one entry.
 */
function groupByKey(elements: readonly AXTreeElement[]): Map<string, AXTreeElement[]> {
	const groups = new Map<string, AXTreeElement[]>();
	for (const element of elements) {
		const key = stableElementKey(element);
		const group = groups.get(key);
		if (group === undefined) {
			groups.set(key, [element]);
		} else {
			group.push(element);
		}
	}
	return groups;
}

function countValueChanges(prior: readonly AXTreeElement[], current: readonly AXTreeElement[]): number {
	let changed = 0;
	for (let index = 0; index < Math.min(prior.length, current.length); index += 1) {
		if ((prior[index]?.value ?? "") !== (current[index]?.value ?? "")) {
			changed += 1;
		}
	}
	return changed;
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
	const before = groupByKey(previous);
	const after = groupByKey(current);
	const added: AXTreeElement[] = [];
	const changed: Array<{ before: AXTreeElement; after: AXTreeElement }> = [];
	for (const [key, group] of after) {
		const prior = before.get(key) ?? [];
		added.push(...group.slice(prior.length));
		for (let index = 0; index < Math.min(prior.length, group.length); index += 1) {
			const beforeElement = prior[index];
			const afterElement = group[index];
			if (
				beforeElement !== undefined &&
				afterElement !== undefined &&
				(beforeElement.value ?? "") !== (afterElement.value ?? "")
			) {
				changed.push({ before: beforeElement, after: afterElement });
			}
		}
	}
	const removed: AXTreeElement[] = [];
	for (const [key, group] of before) {
		removed.push(...group.slice(after.get(key)?.length ?? 0));
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
