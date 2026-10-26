import { afterEach, describe, expect, it, vi } from "vitest";
import { UTMKeyError, utmKeyChunkSize, utmKeyCodes, utmTextCodes, utmTextScripts } from "./utm-keys.js";

afterEach(() => vi.unstubAllEnvs());

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

	it.each(["", "ctrl+", "hyper+a", "a+b", "ctrl+unknown", "constructor", "__proto__", "constructor+a"])(
		"refuses unsupported combination %j",
		(combo) => {
			expect(() => utmKeyCodes(combo)).toThrow(UTMKeyError);
		},
	);
});

describe("#given text #when planned in chunks #then each character retains its own scan-code call", () => {
	it.each([
		[0, 0],
		[1, 1],
		[7, 1],
		[8, 1],
		[9, 2],
		[33, 5],
	])("batches %i characters into %i invocations by default", (length, count) => {
		vi.stubEnv("APPLE_CUA_UTM_KEY_CHUNK", undefined);
		const scripts = utmTextScripts("a".repeat(length));
		expect(scripts).toHaveLength(count);
		expect(scripts.flatMap((script) => script.split("\n"))).toEqual(
			Array.from({ length }, () => "u.inputScanCode(v, {codes:[30,158]});"),
		);
	});

	it("preserves repeated, shifted, whitespace and punctuation make/break sequences in order", () => {
		const text = "echo CUA123\naaAA!!\t\r";
		const scripts = utmTextScripts(text, { chunkSize: 8 });
		expect(scripts.map((script) => script.split("\n").length)).toEqual([8, 8, 4]);
		expect(scripts.flatMap((script) => script.split("\n"))).toEqual(
			[...text].map((character) => `u.inputScanCode(v, {codes:${JSON.stringify(utmTextCodes(character))}});`),
		);
		expect(utmTextCodes("aaAA")).toEqual([30, 158, 30, 158, 42, 30, 158, 170, 42, 30, 158, 170]);
	});

	it.each([0, 1])("preserves one-character invocations with chunk size %i", (chunkSize) => {
		expect(utmTextScripts("aA", { chunkSize })).toEqual([
			"u.inputScanCode(v, {codes:[30,158]});",
			"u.inputScanCode(v, {codes:[42,30,158,170]});",
		]);
	});

	it("preserves the existing single-character code API and exact invocation shape", () => {
		expect(utmTextCodes("a")).toEqual([30, 158]);
		expect(utmTextScripts("a")).toEqual(["u.inputScanCode(v, {codes:[30,158]});"]);
	});

	it("keeps packed extended codes intact alongside text planning", () => {
		utmTextScripts("echo CUA123");
		expect(utmKeyCodes("win+left")).toEqual([0xe05b, 0xe04b, 0xe0cb, 0xe0db]);
	});

	it("rejects unsupported characters before returning a partial plan", () => {
		expect(() => utmTextScripts(`${"a".repeat(8)}\u0000`)).toThrow(UTMKeyError);
		expect(() => utmTextScripts("a\u00e9")).toThrow(UTMKeyError);
	});

	it("uses the environment configuration and permits an explicit override", () => {
		vi.stubEnv("APPLE_CUA_UTM_KEY_CHUNK", "2");
		expect(utmTextScripts("abc")).toHaveLength(2);
		expect(utmTextScripts("abc", { chunkSize: 1 })).toHaveLength(3);
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		"falls back to eight for invalid option %s",
		(chunkSize) => {
			expect(utmTextScripts("a".repeat(9), { chunkSize })).toHaveLength(2);
		},
	);
});

describe("#given chunk configuration #when parsed #then invalid values use eight and zero means one", () => {
	it.each([
		[undefined, 8],
		["", 8],
		["   ", 8],
		["\t\n", 8],
		["garbage", 8],
		["8junk", 8],
		["1.5", 8],
		["8.0", 8],
		["-1", 8],
		["-0", 8],
		["NaN", 8],
		["Infinity", 8],
		["1e2", 8],
		["0x10", 8],
		["9007199254740992", 8],
		["0", 1],
		["1", 1],
		["7", 7],
		["8", 8],
		["9", 9],
		["33", 33],
		[" 2 ", 2],
	])("parses %j as %i", (value, expected) => {
		expect(utmKeyChunkSize(value)).toBe(expected);
		vi.stubEnv("APPLE_CUA_UTM_KEY_CHUNK", value);
		expect(utmTextScripts("a".repeat(33))).toHaveLength(Math.ceil(33 / expected));
	});
});
