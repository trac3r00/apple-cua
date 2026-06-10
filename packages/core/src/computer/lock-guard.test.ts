import { describe, expect, it } from "vitest";

import { SCREEN_LOCKED_MESSAGE, assertScreenUnlocked } from "./lock-guard.js";

describe("#given the screen is locked #when guarding an action #then it refuses with a clear message", () => {
	it("throws the locked message", () => {
		expect(() => assertScreenUnlocked(true)).toThrow(SCREEN_LOCKED_MESSAGE);
	});
});

describe("#given the screen is unlocked #when guarding an action #then it proceeds", () => {
	it("does not throw", () => {
		expect(() => assertScreenUnlocked(false)).not.toThrow();
	});
});
