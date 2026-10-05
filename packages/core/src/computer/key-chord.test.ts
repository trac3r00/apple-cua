import { describe, expect, it } from "vitest";
import { parseKeyChord } from "./actions.js";

describe("#given a key chord #when it is parsed #then the plus key survives the plus separator", () => {
	it.each([
		["+", { key: "=", modifiers: ["shift"] }],
		["cmd++", { key: "=", modifiers: ["command", "shift"] }],
		["cmd+a", { key: "a", modifiers: ["command"] }],
		["=", { key: "=", modifiers: [] }],
	])("parses %s", (chord, expected) => {
		expect(parseKeyChord(chord)).toEqual(expected);
	});

	it("still rejects an empty chord", () => {
		expect(() => parseKeyChord("  ")).toThrow(/non-empty/);
	});
});
