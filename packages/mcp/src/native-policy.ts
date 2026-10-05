import { AppApprovalStore, MacOSHostComputer, listTopLevelWindows, renamedEnvironmentVariable } from "@apple-cua/core";
import type { GuardedComputerInterface, InputDelivery, WindowProbe } from "@apple-cua/core";

export function allowedBundleIdsFromEnvironment(value: string | undefined): readonly string[] {
	return (value ?? "")
		.split(",")
		.map((bundleId) => bundleId.trim())
		.filter((bundleId) => bundleId.length > 0);
}

/**
 * Background is the default: apple-cua acts in its target app without taking focus or moving the
 * person's cursor, so they can keep using the Mac. "attended" opts into routes that may briefly
 * take the foreground.
 */
export function deliveryFromEnvironment(value: string | undefined): InputDelivery {
	return value?.trim().toLowerCase() === "attended" ? "attended" : "background";
}

/** Approved bundle IDs from the host environment; the pre-rename variable name is still honoured. */
export function allowedBundleIdsFromProcessEnvironment(): readonly string[] {
	return allowedBundleIdsFromEnvironment(
		renamedEnvironmentVariable("APPLE_CUA_ALLOWED_BUNDLE_IDS", "MACOS_CUA_ALLOWED_BUNDLE_IDS"),
	);
}

/** Delivery mode from the host environment; the pre-rename variable name is still honoured. */
export function deliveryFromProcessEnvironment(): InputDelivery {
	return deliveryFromEnvironment(renamedEnvironmentVariable("APPLE_CUA_DELIVERY", "MACOS_CUA_DELIVERY"));
}

export function createNativeComputer(): GuardedComputerInterface {
	return new MacOSHostComputer({
		appApproval: new AppApprovalStore(allowedBundleIdsFromProcessEnvironment()),
		delivery: deliveryFromProcessEnvironment(),
	});
}

export function createNativeWindowProbe(): WindowProbe | undefined {
	return process.platform === "darwin" ? listTopLevelWindows : undefined;
}
