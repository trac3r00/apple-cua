import { describe, expect, it } from "vitest";

import { type AssertionBinding, createDisplaySleepAssertion } from "./power.js";

function fakeBinding(): AssertionBinding & { created: number; released: number[] } {
	const state = { created: 0, released: [] as number[] };
	return {
		create() {
			state.created += 1;
			return 7;
		},
		release(id: number) {
			state.released.push(id);
		},
		get created() {
			return state.created;
		},
		get released() {
			return state.released;
		},
	};
}

describe("#given a display-sleep assertion #when acquired repeatedly #then it is created once and released once", () => {
	it("holds a single assertion and releases it cleanly", () => {
		const binding = fakeBinding();
		const assertion = createDisplaySleepAssertion(binding);

		assertion.acquire();
		assertion.acquire();
		assertion.release();
		assertion.release();

		expect(binding.created).toBe(1);
		expect(binding.released).toEqual([7]);
	});
});

describe("#given a released assertion #when re-acquired #then a fresh assertion is created", () => {
	it("re-creates after release", () => {
		const binding = fakeBinding();
		const assertion = createDisplaySleepAssertion(binding);

		assertion.acquire();
		assertion.release();
		assertion.acquire();

		expect(binding.created).toBe(2);
	});
});
