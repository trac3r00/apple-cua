import { AppApprovalStore, MacOSHostComputer, listTopLevelWindows } from "@apple-cua/core";
import type { GuardedComputerInterface, InputDelivery, WindowProbe } from "@apple-cua/core";

export function allowedBundleIdsFromEnvironment(value: string | undefined): readonly string[] | undefined {
	return value
		?.split(",")
		.map((bundleId) => bundleId.trim())
		.filter((bundleId) => bundleId.length > 0);
}

/**
 * The shared-host backend is observation-only. Preserve an explicit attended request so the
 * constructor rejects it, rather than silently accepting a request to borrow the human desktop.
 */
function deliveryFromEnvironment(value: string | undefined): InputDelivery {
	return value?.trim().toLowerCase() === "attended" ? "attended" : "background";
}

/** Optional exact restriction: unset permits named apps; explicitly empty permits none. */
export function allowedBundleIdsFromProcessEnvironment(): readonly string[] | undefined {
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
	if (process.platform !== "darwin") return undefined;
	return (options) => {
		return listTopLevelWindows({
			...options,
			includeOffscreen: options?.includeOffscreen ?? deliveryFromProcessEnvironment() === "background",
		});
	};
}
