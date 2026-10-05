import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedBundleIdsFromProcessEnvironment, deliveryFromProcessEnvironment } from "./native-policy.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("#given only the pre-rename allowlist variable #when the process environment is read #then existing harness configs keep their approved apps", () => {
	it("honours MACOS_CUA_ALLOWED_BUNDLE_IDS", () => {
		vi.stubEnv("MACOS_CUA_ALLOWED_BUNDLE_IDS", "com.apple.TextEdit, com.apple.Finder");

		expect(allowedBundleIdsFromProcessEnvironment()).toEqual(["com.apple.TextEdit", "com.apple.Finder"]);
	});

	it("lets APPLE_CUA_ALLOWED_BUNDLE_IDS win when both are set", () => {
		vi.stubEnv("MACOS_CUA_ALLOWED_BUNDLE_IDS", "com.apple.TextEdit");
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", "com.apple.Finder");

		expect(allowedBundleIdsFromProcessEnvironment()).toEqual(["com.apple.Finder"]);
	});

	it("stays deny-by-default when neither name is set", () => {
		expect(allowedBundleIdsFromProcessEnvironment()).toEqual([]);
	});
});

describe("#given only the pre-rename delivery variable #when the process environment is read #then background delivery is still selected", () => {
	it("honours MACOS_CUA_DELIVERY", () => {
		vi.stubEnv("MACOS_CUA_DELIVERY", "background");

		expect(deliveryFromProcessEnvironment()).toBe("background");
	});

	it("defaults to background delivery when neither name is set", () => {
		expect(deliveryFromProcessEnvironment()).toBe("background");
	});

	it("selects attended delivery only when asked for", () => {
		vi.stubEnv("APPLE_CUA_DELIVERY", "attended");

		expect(deliveryFromProcessEnvironment()).toBe("attended");
	});
});
