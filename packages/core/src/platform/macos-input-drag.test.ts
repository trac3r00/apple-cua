import { describe, expect, it } from "vitest";
import { dragSteps, easedProgress, interpolatePointEased } from "./macos-input-drag.js";

describe("#given an explicit drag duration", () => {
	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 30_001, Number.MAX_VALUE])(
		"#when duration is %s #then rejects an unbounded gesture",
		(duration) => {
			expect(() => dragSteps(duration)).toThrow(RangeError);
		},
	);

	it("#when duration is within the public gesture range #then preserves zero and thirty second gestures", () => {
		expect(dragSteps(0)).toBe(1);
		expect(dragSteps(600)).toBe(38);
		expect(dragSteps(30_000)).toBe(1875);
	});
});

describe("#given a pointer travelling between two points #when the path is generated #then it accelerates and decelerates like a hand instead of jumping linearly", () => {
	const from = { x: 0, y: 0 };
	const to = { x: 100, y: 200 };

	it("keeps both endpoints exactly where they were asked for", () => {
		expect(interpolatePointEased(from, to, 0)).toEqual(from);
		expect(interpolatePointEased(from, to, 1)).toEqual(to);
	});

	it("is slower than linear at the start and at the end, and faster in the middle", () => {
		const quarter = interpolatePointEased(from, to, 0.25);
		const half = interpolatePointEased(from, to, 0.5);
		const threeQuarters = interpolatePointEased(from, to, 0.75);

		expect(quarter.x).toBeLessThan(25);
		expect(half.x).toBe(50);
		expect(threeQuarters.x).toBeGreaterThan(75);
	});

	it("never travels backwards and never overshoots the target", () => {
		const xs = Array.from({ length: 21 }, (_value, index) => interpolatePointEased(from, to, index / 20).x);
		for (let index = 1; index < xs.length; index += 1) {
			const previous = xs[index - 1] ?? 0;
			const current = xs[index] ?? 0;
			expect(current).toBeGreaterThanOrEqual(previous);
			expect(current).toBeLessThanOrEqual(to.x);
		}
	});
});

describe("#given an eased progress curve #when it is sampled #then it is a smoothstep that starts and ends still", () => {
	it("pins both ends and pivots around the middle", () => {
		expect(easedProgress(0)).toBe(0);
		expect(easedProgress(1)).toBe(1);
		expect(easedProgress(0.5)).toBeCloseTo(0.5, 10);
		expect(easedProgress(0.25)).toBeLessThan(0.25);
		expect(easedProgress(0.75)).toBeGreaterThan(0.75);
	});
});
