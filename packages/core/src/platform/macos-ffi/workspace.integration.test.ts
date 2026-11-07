import { describe, expect, it } from "bun:test";
import { findRunningApplication } from "./workspace.js";

describe.if(process.platform === "darwin")(
	"#given AppKit and Finder are available #when directly looking up Finder #then a plausible running application is returned",
	() => {
		it("finds Finder by bundle identifier without timing-dependent assertions", () => {
			const finder = findRunningApplication("com.apple.finder");

			expect(finder).toEqual(
				expect.objectContaining({
					name: "Finder",
					bundleId: "com.apple.finder",
					pid: expect.any(Number),
					isActive: expect.any(Boolean),
					path: expect.stringContaining("Finder.app"),
				}),
			);
			expect(finder?.pid).toBeGreaterThan(0);
			expect(Number.isSafeInteger(finder?.pid)).toBe(true);
		});
	},
);
