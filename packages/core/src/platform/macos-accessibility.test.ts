import { describe, expect, it } from "vitest";

import { resolveElementCoordinate } from "./macos-accessibility.js";

describe("#given AX tree elements #when resolving an element coordinate #then the frame center is returned", () => {
	it("returns the center point for a valid element index", () => {
		const point = resolveElementCoordinate(
			[
				{
					id: 2,
					role: "AXButton",
					label: "OK",
					value: null,
					frame: { x: 10, y: 20, width: 30, height: 40 },
					actions: ["AXPress"],
					children: [],
				},
			],
			2,
		);

		expect(point).toEqual({ x: 25, y: 40 });
	});

	it("throws for missing or zero-size elements", () => {
		expect(() => resolveElementCoordinate([], 9)).toThrow("Element index 9 not found in AX tree");
		expect(() =>
			resolveElementCoordinate(
				[
					{
						id: 1,
						role: "AXStaticText",
						label: null,
						value: null,
						frame: { x: 0, y: 0, width: 0, height: 10 },
						actions: [],
						children: [],
					},
				],
				1,
			),
		).toThrow("Element 1 has zero-size frame");
	});
});
