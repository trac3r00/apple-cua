import { describe, expect, it } from "vitest";

import { blockedUrl, isBrowserBundle } from "./url-blocklist.js";

describe("#given blocklist glob patterns #when matching a URL #then wildcard matches are detected", () => {
	it("blocks a URL matching a wildcard pattern", () => {
		expect(blockedUrl("https://banking.example.com/login", ["*banking*"])).toBe(true);
	});

	it("allows a URL that matches no pattern", () => {
		expect(blockedUrl("https://mail.google.com", ["*banking*", "*admin*"])).toBe(false);
	});

	it("blocks when any pattern matches", () => {
		expect(blockedUrl("https://corp/internal/admin", ["*admin*", "*payroll*"])).toBe(true);
	});

	it("treats an empty blocklist as allow-all", () => {
		expect(blockedUrl("https://anything", [])).toBe(false);
	});

	it("escapes regex metacharacters in patterns", () => {
		expect(blockedUrl("https://a.b.com", ["*a.b.com*"])).toBe(true);
		expect(blockedUrl("https://axbycom", ["*a.b.com*"])).toBe(false);
	});
});

describe("#given an app bundle id #when checking if it is a browser #then known browsers are recognized", () => {
	it("recognizes Safari and Chrome case-insensitively", () => {
		expect(isBrowserBundle("com.apple.Safari")).toBe(true);
		expect(isBrowserBundle("com.google.Chrome")).toBe(true);
		expect(isBrowserBundle("com.apple.finder")).toBe(false);
	});
});
