import { describe, expect, it } from "vitest";

import { parseAppUsageBlocks } from "./app-usage.js";

const OUTPUT = [
	"kMDItemLastUsedDate = 2026-06-10 09:05:57 +0000",
	"kMDItemUseCount     = 10",
	"kMDItemLastUsedDate = (null)",
	"kMDItemUseCount     = (null)",
].join("\n");

describe("#given mdls usage blocks #when parsed in path order #then each app maps to its usage", () => {
	it("extracts last-used date and use count per app", () => {
		const usage = parseAppUsageBlocks(OUTPUT, ["/A.app", "/B.app"]);

		expect(usage.get("/A.app")).toEqual({ lastUsedDate: "2026-06-10 09:05:57 +0000", useCount: 10 });
	});

	it("treats (null) attributes as absent", () => {
		const usage = parseAppUsageBlocks(OUTPUT, ["/A.app", "/B.app"]);

		expect(usage.get("/B.app")).toEqual({});
	});
});

describe("#given a mismatched block count #when parsed #then it degrades to empty usage", () => {
	it("returns empty usage when lines do not line up with paths", () => {
		const usage = parseAppUsageBlocks("kMDItemUseCount = 3", ["/A.app", "/B.app"]);

		expect(usage.get("/A.app")).toEqual({});
		expect(usage.get("/B.app")).toEqual({});
	});
});
