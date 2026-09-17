import { describe, expect, it } from "vitest";
import { comboParts, gesturePath, swipeDurationMs, typingPlan } from "./ios-input.js";

describe("#given a swipe between two points #when the gesture path is built #then it eases like a finger and lands exactly on the target", () => {
	const from = { x: 200, y: 600 };
	const to = { x: 200, y: 200 };

	it("includes both endpoints and the requested number of intermediate steps", () => {
		const path = gesturePath(from, to, 6);

		expect(path).toHaveLength(7);
		expect(path[0]).toEqual(from);
		expect(path[6]).toEqual(to);
	});

	it("moves furthest in the middle of the gesture, which is what iOS reads as a flick", () => {
		const path = gesturePath(from, to, 8);
		const deltas = path.slice(1).map((point, index) => Math.abs((path[index]?.y ?? 0) - point.y));
		const middle = deltas.slice(2, 6);
		const first = deltas[0] ?? 0;
		const last = deltas[deltas.length - 1] ?? 0;

		for (const delta of middle) {
			expect(delta).toBeGreaterThan(first);
			expect(delta).toBeGreaterThan(last);
		}
	});

	it("refuses a gesture with no steps instead of returning an empty path", () => {
		expect(() => gesturePath(from, to, 0)).toThrow(/at least one step/i);
	});
});

describe("#given a distance #when a swipe duration is chosen #then a short fast flick and a long drag are different gestures", () => {
	it("keeps a flick under the momentum threshold and a drag slow enough to register", () => {
		expect(swipeDurationMs(300, "flick")).toBeLessThanOrEqual(200);
		expect(swipeDurationMs(300, "drag")).toBeGreaterThan(swipeDurationMs(300, "flick"));
	});
});

describe("#given a key combo #when it is parsed #then the key and its held modifiers are separated", () => {
	it("reads cmd+1 and cmd+shift+z", () => {
		expect(comboParts("cmd+1")).toEqual({ key: "1", modifiers: ["cmd"] });
		expect(comboParts("cmd+shift+z")).toEqual({ key: "z", modifiers: ["cmd", "shift"] });
		expect(comboParts("return")).toEqual({ key: "return", modifiers: [] });
	});

	it("rejects an unknown key rather than posting nothing", () => {
		expect(() => comboParts("cmd+frobnicate")).toThrow(/unsupported key/i);
	});
});

describe("#given text #when the keystroke plan is built #then every character becomes the keycode iPhone Mirroring can forward", () => {
	it("routes shifted characters through shift and their base key", () => {
		const plan = typingPlan("Hi!");

		// "!" is shift+1 on a US layout, so the digit is typed with shift held.
		expect(plan.map((entry) => entry.key)).toEqual(["h", "i", "1"]);
		expect(plan.map((entry) => entry.shift)).toEqual([true, false, true]);
	});

	it("plans a return between lines and refuses characters that have no keycode", () => {
		const plan = typingPlan("a\nb");

		expect(plan.map((entry) => entry.key)).toEqual(["a", "return", "b"]);
		expect(() => typingPlan("🙂")).toThrow(/cannot type/i);
	});
});
