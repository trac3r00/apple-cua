import { describe, expect, it } from "vitest";

import { resolveAppInstructions } from "./index.js";

describe("#given a known app bundle id #when resolving instructions #then the playbook is returned", () => {
	it("returns Clock guidance by bundle id", () => {
		const instructions = resolveAppInstructions("Clock", "com.apple.clock");

		expect(instructions).toContain("World Clock");
	});

	it("matches case-insensitively by bundle id", () => {
		expect(resolveAppInstructions("Clock", "COM.APPLE.CLOCK")).toContain("Timer");
	});
});

describe("#given an unknown app #when resolving instructions #then nothing is returned", () => {
	it("returns undefined for apps without a playbook", () => {
		expect(resolveAppInstructions("Calculator", "com.apple.calculator")).toBeUndefined();
	});
});
