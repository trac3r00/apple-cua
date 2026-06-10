import { describe, expect, it } from "vitest";

import { resolveSelectionRange } from "./select-text.js";

describe("#given no target text #when resolving a selection #then the whole value is covered", () => {
	it("selects the entire value", () => {
		expect(resolveSelectionRange({ value: "hello", selection: "text" })).toEqual({ location: 0, length: 5 });
	});

	it("places the cursor before the value", () => {
		expect(resolveSelectionRange({ value: "hello", selection: "before" })).toEqual({ location: 0, length: 0 });
	});

	it("places the cursor after the value", () => {
		expect(resolveSelectionRange({ value: "hello", selection: "after" })).toEqual({ location: 5, length: 0 });
	});
});

describe("#given target text inside the value #when resolving a selection #then the match range is used", () => {
	it("selects the matched substring", () => {
		expect(resolveSelectionRange({ value: "abcXYZdef", text: "XYZ", selection: "text" })).toEqual({
			location: 3,
			length: 3,
		});
	});

	it("places the cursor before the match", () => {
		expect(resolveSelectionRange({ value: "abcXYZdef", text: "XYZ", selection: "before" })).toEqual({
			location: 3,
			length: 0,
		});
	});

	it("places the cursor after the match", () => {
		expect(resolveSelectionRange({ value: "abcXYZdef", text: "XYZ", selection: "after" })).toEqual({
			location: 6,
			length: 0,
		});
	});
});

describe("#given a repeated target #when a suffix disambiguates it #then the disambiguated match range is used", () => {
	it("selects the occurrence identified by the suffix", () => {
		expect(resolveSelectionRange({ value: "foo bar foo baz", text: "foo", suffix: " baz", selection: "text" })).toEqual(
			{ location: 8, length: 3 },
		);
	});

	it("selects the occurrence identified by the prefix", () => {
		expect(resolveSelectionRange({ value: "foo bar foo baz", text: "foo", prefix: "bar ", selection: "text" })).toEqual(
			{ location: 8, length: 3 },
		);
	});
});

describe("#given a target that is absent #when resolving a selection #then it throws", () => {
	it("rejects text that does not appear in the value", () => {
		expect(() => resolveSelectionRange({ value: "hello", text: "world", selection: "text" })).toThrow(
			/could not find/i,
		);
	});
});
