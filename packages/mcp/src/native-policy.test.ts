import { AppApprovalStore, listTopLevelWindows } from "@apple-cua/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	allowedBundleIdsFromProcessEnvironment,
	createNativeWindowProbe,
	deliveryFromProcessEnvironment,
} from "./native-policy.js";

vi.mock("@apple-cua/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@apple-cua/core")>()),
	listTopLevelWindows: vi.fn(async () => []),
}));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

describe("#given native window discovery #when its delivery policy is selected #then only background defaults to all Spaces", () => {
	it.each([
		{ delivery: undefined, includeOffscreen: undefined, expected: true },
		{ delivery: "attended", includeOffscreen: undefined, expected: false },
		{ delivery: undefined, includeOffscreen: false, expected: false },
	])("preserves explicit scope under $delivery delivery", async ({ delivery, includeOffscreen, expected }) => {
		vi.stubEnv("APPLE_CUA_DELIVERY", delivery);
		const probe = createNativeWindowProbe();
		if (probe === undefined) {
			expect(process.platform).not.toBe("darwin");
			return;
		}
		await probe({
			titlesFor: [42],
			...(includeOffscreen === undefined ? {} : { includeOffscreen }),
		});
		expect(listTopLevelWindows).toHaveBeenCalledWith({ titlesFor: [42], includeOffscreen: expected });
	});
});

describe("#given the allowlist variable #when the process environment is read #then it lists the approved apps", () => {
	it("splits APPLE_CUA_ALLOWED_BUNDLE_IDS on commas and trims each id", () => {
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", "com.apple.TextEdit, com.apple.Finder");

		expect(allowedBundleIdsFromProcessEnvironment()).toEqual(["com.apple.TextEdit", "com.apple.Finder"]);
	});

	it("allows any explicitly named app when it is not set", () => {
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", undefined);

		const allowed = allowedBundleIdsFromProcessEnvironment();
		expect(allowed).toBeUndefined();
		expect(new AppApprovalStore(allowed).decide("com.example.unlisted")).toBe("approved");
	});

	it.each(["", " ,  , "])("keeps an explicitly empty restriction closed: %j", (value) => {
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", value);

		const allowed = allowedBundleIdsFromProcessEnvironment();
		expect(allowed).toEqual([]);
		expect(new AppApprovalStore(allowed).decide("com.example.unlisted")).toBe("needs-approval");
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
