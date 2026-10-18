import { describe, expect, it } from "vitest";

import { matchElements } from "./element-query.js";
import type { AXTreeElement } from "./types.js";

function element(overrides: Partial<AXTreeElement> & { id: number; role: string }): AXTreeElement {
	return {
		label: null,
		value: null,
		frame: { x: 0, y: 0, width: 10, height: 10 },
		actions: [],
		children: [],
		...overrides,
	};
}

describe("#given tiny named browser controls #when queried #then actionable controls outrank competing wrappers", () => {
	it("ranks the 4-by-4 AXPress control above a disabled wrapper and static text", () => {
		const elements = [
			element({ id: 1, role: "AXGroup", label: "Close tab", frame: { x: 0, y: 0, width: 20, height: 20 } }),
			element({ id: 2, role: "AXStaticText", label: "Close tab", frame: { x: 0, y: 0, width: 4, height: 4 } }),
			element({
				id: 3,
				role: "AXButton",
				label: "Close tab",
				frame: { x: 0, y: 0, width: 4, height: 4 },
				actions: ["AXPress"],
			}),
		];

		const matches = matchElements(elements, { label: "Close tab" });

		expect(matches.map((match) => match.element.id)).toEqual([3, 1, 2]);
		expect(matches[0]?.matchedBy).toContain("pressable");
	});

	it("selects named controls whose accessible names change dynamically", () => {
		const elements = [
			element({
				id: 4,
				role: "AXButton",
				label: "Mute tab",
				frame: { x: 0, y: 0, width: 4, height: 4 },
				actions: ["AXPress"],
			}),
			element({
				id: 5,
				role: "AXButton",
				label: "Unmute tab",
				frame: { x: 0, y: 0, width: 4, height: 4 },
				actions: ["AXPress"],
			}),
		];

		expect(matchElements(elements, { label: "Unmute tab" }).map((match) => match.element.id)).toEqual([5]);
	});
});
