import { describe, expect, it } from "vitest";

import { normalizeAxTree } from "./normalize.js";
import type { AXTreeElement } from "./types.js";

function el(partial: Partial<AXTreeElement> & { id: number; role: string }): AXTreeElement {
	return {
		label: null,
		value: null,
		frame: { x: 0, y: 0, width: 10, height: 10 },
		actions: [],
		children: [],
		...partial,
	};
}

describe("#given a tree with non-descriptive noise #when normalized #then noise is dropped and ids are preserved", () => {
	it("keeps descriptive nodes and containers with kept descendants, dropping the rest", () => {
		const tree: AXTreeElement[] = [
			el({ id: 0, role: "AXWindow", label: "Main", children: [1, 2] }),
			el({ id: 1, role: "AXGroup", children: [3] }),
			el({ id: 2, role: "AXUnknown" }),
			el({ id: 3, role: "AXButton", label: "OK", actions: ["AXPress"] }),
		];

		const result = normalizeAxTree(tree);

		expect(result.map((element) => element.id)).toEqual([0, 1, 3]);
		expect(result.find((element) => element.id === 0)?.children).toEqual([1]);
	});
});

describe("#given a container whose only child is noise #when normalized #then the empty container is dropped too", () => {
	it("drops a group that has no kept descendants", () => {
		const tree: AXTreeElement[] = [el({ id: 0, role: "AXGroup", children: [1] }), el({ id: 1, role: "AXUnknown" })];

		expect(normalizeAxTree(tree)).toEqual([]);
	});
});
