import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedBundleIdsFromProcessEnvironment, deliveryFromProcessEnvironment } from "./native-policy.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("#given the allowlist variable #when the process environment is read #then it lists the approved apps", () => {
	it("splits APPLE_CUA_ALLOWED_BUNDLE_IDS on commas and trims each id", () => {
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", "com.apple.TextEdit, com.apple.Finder");

		expect(allowedBundleIdsFromProcessEnvironment()).toEqual(["com.apple.TextEdit", "com.apple.Finder"]);
	});

	it("stays deny-by-default when it is not set", () => {
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", undefined);

		expect(allowedBundleIdsFromProcessEnvironment()).toEqual([]);
	});
});

describe("#given the delivery variable #when the process environment is read #then background is the default", () => {
	it("defaults to background delivery when it is not set", () => {
		vi.stubEnv("APPLE_CUA_DELIVERY", undefined);

		expect(deliveryFromProcessEnvironment()).toBe("background");
	});

	it("selects attended delivery only when asked for", () => {
		vi.stubEnv("APPLE_CUA_DELIVERY", "attended");

		expect(deliveryFromProcessEnvironment()).toBe("attended");
	});
});
