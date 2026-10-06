import { AppApprovalStore, MacOSHostComputer, listTopLevelWindows } from "@apple-cua/core";
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
function deliveryFromEnvironment(value: string | undefined): InputDelivery {
	return value?.trim().toLowerCase() === "attended" ? "attended" : "background";
}

/** Approved bundle IDs from the host environment. */
export function allowedBundleIdsFromProcessEnvironment(): readonly string[] {
	return allowedBundleIdsFromEnvironment(process.env["APPLE_CUA_ALLOWED_BUNDLE_IDS"]);
}

/** Delivery mode from the host environment. */
export function deliveryFromProcessEnvironment(): InputDelivery {
	return deliveryFromEnvironment(process.env["APPLE_CUA_DELIVERY"]);
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
