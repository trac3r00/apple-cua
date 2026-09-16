import { describe, expect, it } from "vitest";

import { stableElementKey } from "./stable-element-key.js";
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

describe("#given the same element identity #when keyed #then the key is stable across positional ids and value changes", () => {
	it("ignores positional id and value, keying on role + label + vertical position", () => {
		const a = el({ id: 0, role: "AXButton", label: "Save", value: null });
		const b = el({ id: 42, role: "AXButton", label: "Save", value: "changed" });

		expect(stableElementKey(a)).toBe(stableElementKey(b));
	});

	it("ignores the horizontal jitter that live list cells show between identical walks", () => {
		const before = el({ id: 0, role: "AXTextField", frame: { x: 639, y: 15, width: 91, height: 18 } });
		const after = el({ id: 0, role: "AXTextField", frame: { x: 639, y: 15, width: 52, height: 18 } });
		const shifted = el({ id: 0, role: "AXTextField", frame: { x: 668, y: 15, width: 23, height: 18 } });

		expect(stableElementKey(before)).toBe(stableElementKey(after));
		expect(stableElementKey(before)).toBe(stableElementKey(shifted));
	});
});

describe("#given different identity #when keyed #then the keys differ", () => {
	it("differs on role, label, or vertical position", () => {
		const base = el({ id: 0, role: "AXButton", label: "Save" });
		expect(stableElementKey(el({ id: 0, role: "AXTextField", label: "Save" }))).not.toBe(stableElementKey(base));
		expect(stableElementKey(el({ id: 0, role: "AXButton", label: "Cancel" }))).not.toBe(stableElementKey(base));
		expect(
			stableElementKey(
				el({ id: 0, role: "AXButton", label: "Save", frame: { x: 0, y: 40, width: 10, height: 10 } }),
			),
		).not.toBe(stableElementKey(base));
	});
});
