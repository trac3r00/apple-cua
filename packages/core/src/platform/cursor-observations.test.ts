import { describe, expect, it } from "bun:test";
import { withCursorIdentity } from "../computer/cursor-scope.js";
import { CursorKeyedObservations } from "./cursor-observations.js";

describe("#given observations of a shared surface and an ordinary app #when cursors record them #then only the surface is kept per cursor", () => {
	it("keeps one observation per cursor for a shared pid and one per app otherwise", () => {
		const store = new CursorKeyedObservations<string>((pid) => pid === 7);

		withCursorIdentity("painter-1", () => store.set(7, "left"));
		withCursorIdentity("painter-2", () => store.set(7, "right"));
		withCursorIdentity("painter-1", () => store.set(9, "first"));
		withCursorIdentity("painter-2", () => store.set(9, "second"));

		expect(withCursorIdentity("painter-1", () => store.get(7))).toBe("left");
		expect(withCursorIdentity("painter-2", () => store.get(7))).toBe("right");
		expect(withCursorIdentity("painter-1", () => store.get(9))).toBe("second");
		expect(store.pids().sort()).toEqual([7, 9]);

		withCursorIdentity("painter-1", () => store.delete(7));
		expect(withCursorIdentity("painter-1", () => store.get(7))).toBeUndefined();
		expect(withCursorIdentity("painter-2", () => store.get(7))).toBe("right");
	});

	it("keeps only the most recent cursors, so workers that came and went do not pile up", () => {
		const store = new CursorKeyedObservations<number>(() => true);
		for (let index = 0; index < 300; index += 1) withCursorIdentity(`painter-${index}`, () => store.set(7, index));

		expect(withCursorIdentity("painter-0", () => store.get(7))).toBeUndefined();
		expect(withCursorIdentity("painter-299", () => store.get(7))).toBe(299);
	});
});
