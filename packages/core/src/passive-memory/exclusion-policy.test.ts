import { describe, expect, it } from "vitest";

import { shouldRecord } from "./exclusion-policy.js";

describe("#given passive memory is disabled #when deciding to record #then it never records", () => {
	it("defaults off even for an allowed app", () => {
		expect(shouldRecord({ bundleId: "com.apple.finder" }, { enabled: false })).toBe(false);
	});
});

describe("#given passive memory is enabled #when the context is not excluded #then it records", () => {
	it("records an allowed app", () => {
		expect(shouldRecord({ bundleId: "com.apple.finder" }, { enabled: true })).toBe(true);
	});
});

describe("#given an excluded context #when deciding to record #then it is skipped", () => {
	it("skips an excluded bundle id (case-insensitive)", () => {
		expect(
			shouldRecord({ bundleId: "com.apple.Safari" }, { enabled: true, excludedBundleIds: ["com.apple.safari"] }),
		).toBe(false);
	});

	it("skips a URL matching an excluded pattern", () => {
		expect(
			shouldRecord(
				{ bundleId: "com.apple.Safari", url: "https://banking.example.com" },
				{ enabled: true, excludedUrlPatterns: ["*banking*"] },
			),
		).toBe(false);
	});
});
