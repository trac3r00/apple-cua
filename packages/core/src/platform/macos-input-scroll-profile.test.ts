import { describe, expect, it } from "vitest";
import { scrollEventPlan } from "./macos-input-drag.js";

describe("#given an eased wheel event planner", () => {
	it.each([0, 1, 3.5, -3.5, 4, -4])("#when planning %s units #then retains the single wheel event", (units) => {
		expect(scrollEventPlan(units)).toEqual([units]);
	});

	it.each([5, -5, 160, -160, 1000, -1000, 10000, -10000])(
		"#when planning %s units #then preserves displacement within the bounded event rate",
		(units) => {
			const plan = scrollEventPlan(units);
			const sum = plan.reduce((total, delta) => total + delta, 0);
			expect(sum).toBeCloseTo(units, 10);
			expect(plan.length).toBeLessThanOrEqual(40);
			expect(((plan.length - 1) * 1000) / (Math.max(1, plan.length - 1) * 14)).toBeLessThanOrEqual(72);
			expect(plan.every((delta) => delta * units >= 0)).toBe(true);
			if (Number.isInteger(units)) {
				expect(sum).toBe(units);
			}
		},
	);

	it.each([3.5, -3.5, 4, -4])("#when planning small units %s #then keeps one event", (units) => {
		expect(scrollEventPlan(units)).toHaveLength(1);
	});

	it("#when planning a long scroll #then the middle is faster than both ends", () => {
		const plan = scrollEventPlan(160);
		const middle = plan[Math.floor(plan.length / 2)] ?? 0;
		expect(middle).toBeGreaterThan(plan[0] ?? 0);
		expect(middle).toBeGreaterThan(plan.at(-1) ?? 0);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"#when planning nonfinite %s units #then rejects an unbounded plan",
		(units) => {
			expect(() => scrollEventPlan(units)).toThrow(RangeError);
		},
	);
});
