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
	it("ignores positional id and value, keying on role + label + frame", () => {
		const a = el({ id: 0, role: "AXButton", label: "Save", value: null });
		const b = el({ id: 42, role: "AXButton", label: "Save", value: "changed" });

		expect(stableElementKey(a)).toBe(stableElementKey(b));
	});
});

describe("#given different identity #when keyed #then the keys differ", () => {
	it("differs on role, label, or frame", () => {
		const base = el({ id: 0, role: "AXButton", label: "Save" });
		expect(stableElementKey(el({ id: 0, role: "AXTextField", label: "Save" }))).not.toBe(stableElementKey(base));
		expect(stableElementKey(el({ id: 0, role: "AXButton", label: "Cancel" }))).not.toBe(stableElementKey(base));
		expect(
			stableElementKey(el({ id: 0, role: "AXButton", label: "Save", frame: { x: 5, y: 0, width: 10, height: 10 } })),
		).not.toBe(stableElementKey(base));
	});
});
