import { describe, expect, it } from "vitest";

import { VirtualPointer } from "./virtual-pointer.js";

describe("#given a freshly seeded pointer #when inspected #then it sits at the seed and is hidden", () => {
	it("starts at the seed position and invisible", () => {
		const pointer = new VirtualPointer({ x: 5, y: 6 });

		expect(pointer.position()).toEqual({ x: 5, y: 6 });
		expect(pointer.isVisible()).toBe(false);
	});
});

describe("#given a pointer #when moved #then it tracks the target and becomes visible", () => {
	it("updates the position and shows the pointer", () => {
		const pointer = new VirtualPointer({ x: 0, y: 0 });

		pointer.moveTo({ x: 120, y: 240 });

		expect(pointer.position()).toEqual({ x: 120, y: 240 });
		expect(pointer.isVisible()).toBe(true);
	});
});

describe("#given a visible pointer #when hidden #then it disappears but keeps its position", () => {
	it("clears visibility without moving", () => {
		const pointer = new VirtualPointer({ x: 0, y: 0 });
		pointer.moveTo({ x: 33, y: 44 });

		pointer.hide();

		expect(pointer.isVisible()).toBe(false);
		expect(pointer.position()).toEqual({ x: 33, y: 44 });
	});
});
