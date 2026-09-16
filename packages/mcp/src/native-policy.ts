import { AppApprovalStore, MacOSHostComputer, listTopLevelWindows } from "@macos-cua/core";
import type { GuardedComputerInterface, InputDelivery, TopLevelWindow } from "@macos-cua/core";

export function allowedBundleIdsFromEnvironment(value: string | undefined): readonly string[] {
	return (value ?? "")
		.split(",")
		.map((bundleId) => bundleId.trim())
		.filter((bundleId) => bundleId.length > 0);
}

export function deliveryFromEnvironment(value: string | undefined): InputDelivery {
	return value?.trim().toLowerCase() === "background" ? "background" : "attended";
}

export function createNativeComputer(): GuardedComputerInterface {
	return new MacOSHostComputer({
		appApproval: new AppApprovalStore(allowedBundleIdsFromEnvironment(process.env["MACOS_CUA_ALLOWED_BUNDLE_IDS"])),
		delivery: deliveryFromEnvironment(process.env["MACOS_CUA_DELIVERY"]),
	});
}

export function createNativeWindowProbe(): (() => Promise<readonly TopLevelWindow[]>) | undefined {
	return process.platform === "darwin" ? listTopLevelWindows : undefined;
}
