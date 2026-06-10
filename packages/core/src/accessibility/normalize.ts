import type { AXTreeElement } from "./types.js";

export function normalizeAxTree(elements: readonly AXTreeElement[]): AXTreeElement[] {
	const byId = new Map(elements.map((element) => [element.id, element]));
	const kept = new Set<number>();
	for (let index = elements.length - 1; index >= 0; index -= 1) {
		const element = elements[index];
		if (element === undefined) {
			continue;
		}
		const hasKeptChild = element.children.some((childId) => kept.has(childId));
		if (isDescriptive(element) || hasKeptChild) {
			kept.add(element.id);
		}
	}
	return elements
		.filter((element) => kept.has(element.id))
		.map((element) => ({
			...element,
			children: element.children.filter((childId) => kept.has(childId) && byId.has(childId)),
		}));
}

function isDescriptive(element: AXTreeElement): boolean {
	return element.role !== "" && (element.label !== null || element.value !== null || element.actions.length > 0);
}
