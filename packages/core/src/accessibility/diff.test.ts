import { describe, expect, it } from "vitest";

import { diffAxTreeChanges, diffAxTrees, diffAxTreesByKey } from "./diff.js";
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

describe("#given reordered/renumbered ids with stable content #when diffed by key #then no spurious changes", () => {
	it("matches elements by content identity, not positional id", () => {
		const previous = [el({ id: 0, role: "AXButton", label: "Save" }), el({ id: 1, role: "AXButton", label: "Open" })];
		const current = [el({ id: 9, role: "AXButton", label: "Open" }), el({ id: 4, role: "AXButton", label: "Save" })];

		expect(diffAxTreesByKey(previous, current)).toEqual({ added: 0, removed: 0, changed: 0 });
	});

	it("reports a value change as changed, not add+remove", () => {
		const previous = [el({ id: 0, role: "AXTextField", label: "Name", value: "old" })];
		const current = [el({ id: 5, role: "AXTextField", label: "Name", value: "new" })];

		expect(diffAxTreesByKey(previous, current)).toEqual({ added: 0, removed: 0, changed: 1 });
	});
});

describe("#given two AX snapshots #when diffed into element changes #then the actual elements are returned", () => {
	it("returns the added, removed, and changed elements keyed by content identity", () => {
		const saveBefore = el({ id: 0, role: "AXButton", label: "Save" });
		const saveAfter = el({ id: 0, role: "AXButton", label: "Save", value: "pressed" });
		const removed = el({ id: 1, role: "AXButton", label: "Old" });
		const added = el({ id: 2, role: "AXButton", label: "New" });

		const changes = diffAxTreeChanges([saveBefore, removed], [saveAfter, added]);

		expect(changes.added).toEqual([added]);
		expect(changes.removed).toEqual([removed]);
		expect(changes.changed).toEqual([{ before: saveBefore, after: saveAfter }]);
	});

	it("reports no element changes for identical snapshots", () => {
		const tree = [el({ id: 0, role: "AXButton", label: "Save" })];

		expect(diffAxTreeChanges(tree, tree)).toEqual({ added: [], removed: [], changed: [] });
	});
});

describe("#given live-list jitter #when diffed by key #then the same controls are not reported as add and remove", () => {
	it("ignores cells that only re-truncated horizontally", () => {
		const before = [el({ id: 0, role: "AXStaticText", frame: { x: 1331, y: 15, width: 46, height: 18 } })];
		const after = [el({ id: 0, role: "AXStaticText", frame: { x: 1362, y: 15, width: 15, height: 18 } })];

		expect(diffAxTreesByKey(before, after)).toEqual({ added: 0, removed: 0, changed: 0 });
		expect(diffAxTreeChanges(before, after)).toEqual({ added: [], removed: [], changed: [] });
	});
});

describe("#given repeated controls #when diffed by key #then counts are compared instead of collapsed", () => {
	it("reports a second identical-looking row as added and its disappearance as removed", () => {
		const one = [el({ id: 0, role: "AXRow", label: "Report.pdf" })];
		const two = [
			el({ id: 0, role: "AXRow", label: "Report.pdf" }),
			el({ id: 3, role: "AXRow", label: "Report.pdf" }),
		];

		expect(diffAxTreesByKey(one, two)).toEqual({ added: 1, removed: 0, changed: 0 });
		expect(diffAxTreesByKey(two, one)).toEqual({ added: 0, removed: 1, changed: 0 });
		expect(diffAxTreeChanges(one, two).added).toEqual([two[1]]);
		expect(diffAxTreeChanges(two, one).removed).toEqual([two[1]]);
	});

	it("still reports a value change among repeated controls", () => {
		const before = [el({ id: 0, role: "AXTextField", label: "Name", value: "old" })];
		const after = [el({ id: 7, role: "AXTextField", label: "Name", value: "new" })];

		expect(diffAxTreesByKey(before, after)).toEqual({ added: 0, removed: 0, changed: 1 });
	});
});

describe("#given identical snapshots #when diffed #then nothing changed", () => {
	it("reports zero changes", () => {
		const tree = [el({ id: 0, role: "AXButton", label: "Save" })];

		expect(diffAxTrees(tree, tree)).toEqual({ added: 0, removed: 0, changed: 0 });
	});
});
