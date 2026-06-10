import { describe, expect, it } from "vitest";

import { diffAxTrees } from "./diff.js";
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

describe("#given two AX snapshots #when diffed by id #then added, removed, and changed are counted", () => {
	it("counts an added, a removed, and a changed element", () => {
		const previous = [el({ id: 0, role: "AXButton", label: "Save" }), el({ id: 1, role: "AXButton", label: "Old" })];
		const current = [
			el({ id: 0, role: "AXButton", label: "Save", value: "pressed" }),
			el({ id: 2, role: "AXButton", label: "New" }),
		];

		expect(diffAxTrees(previous, current)).toEqual({ added: 1, removed: 1, changed: 1 });
	});
});

describe("#given identical snapshots #when diffed #then nothing changed", () => {
	it("reports zero changes", () => {
		const tree = [el({ id: 0, role: "AXButton", label: "Save" })];

		expect(diffAxTrees(tree, tree)).toEqual({ added: 0, removed: 0, changed: 0 });
	});
});
