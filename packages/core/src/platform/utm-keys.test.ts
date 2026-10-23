import { describe, expect, it } from "vitest";
import { UTMKeyError, utmKeyCodes } from "./utm-keys.js";

describe("#given a guest key combination #when encoded #then every key is released in reverse order", () => {
	it("encodes Ctrl+Alt+Delete with extended make and break prefixes", () => {
		expect(utmKeyCodes("ctrl+alt+delete")).toEqual([29, 56, 0xe053, 0xe0d3, 184, 157]);
	});

	it("encodes the Windows key without confusing it with a host command", () => {
		expect(utmKeyCodes("win+r")).toEqual([0xe05b, 19, 147, 0xe0db]);
	});

	it("releases a standalone key", () => {
		expect(utmKeyCodes("enter")).toEqual([28, 156]);
	});

	it.each(["", "ctrl+", "hyper+a", "a+b", "ctrl+unknown"])("refuses unsupported combination %j", (combo) => {
		expect(() => utmKeyCodes(combo)).toThrow(UTMKeyError);
	});
});
