import { describe, expect, it, vi } from "vitest";

const macPermissionsMock = vi.hoisted(() => ({
	askForAccessibilityAccess: vi.fn<() => Promise<void>>(),
	askForAppleEventsAccess: vi.fn<(bundleId: string) => Promise<void>>(),
	askForInputMonitoringAccess: vi.fn<() => Promise<void>>(),
	askForScreenCaptureAccess: vi.fn<() => Promise<void>>(),
	getAuthStatus: vi.fn<(kind: string) => string>(),
}));

vi.mock("node-mac-permissions", () => ({
	default: macPermissionsMock,
	...macPermissionsMock,
}));

describe("#given macos permissions", () => {
	describe("#when checking each permission kind", () => {
		it("#then calls node-mac-permissions with the matching permission name", async () => {
			const { MacOSPermissions } = await import("./macos.js");
			const permissions = new MacOSPermissions();
			macPermissionsMock.getAuthStatus.mockReturnValue("authorized");

			await expect(permissions.check("screen")).resolves.toBe("authorized");
			await expect(permissions.check("accessibility")).resolves.toBe("authorized");
			await expect(permissions.check("input-monitoring")).resolves.toBe("authorized");
			await expect(permissions.check("apple-events")).resolves.toBe("authorized");

			expect(macPermissionsMock.getAuthStatus).toHaveBeenNthCalledWith(1, "screen");
			expect(macPermissionsMock.getAuthStatus).toHaveBeenNthCalledWith(2, "accessibility");
			expect(macPermissionsMock.getAuthStatus).toHaveBeenNthCalledWith(3, "input-monitoring");
			expect(macPermissionsMock.getAuthStatus).toHaveBeenNthCalledWith(4, "apple-events");
		});
	});

	describe("#when checking every supported native status", () => {
		it("#then maps each status into the public permission status union", async () => {
			const { MacOSPermissions } = await import("./macos.js");
			const permissions = new MacOSPermissions();

			macPermissionsMock.getAuthStatus.mockReturnValue("not-determined");
			await expect(permissions.check("screen")).resolves.toBe("not-determined");

			macPermissionsMock.getAuthStatus.mockReturnValue("denied");
			await expect(permissions.check("screen")).resolves.toBe("denied");

			macPermissionsMock.getAuthStatus.mockReturnValue("authorized");
			await expect(permissions.check("screen")).resolves.toBe("authorized");

			macPermissionsMock.getAuthStatus.mockReturnValue("restricted");
			await expect(permissions.check("screen")).resolves.toBe("restricted");
		});
	});

	describe("#when requesting each permission kind", () => {
		it("#then calls the matching request method", async () => {
			const { MacOSPermissions } = await import("./macos.js");
			const permissions = new MacOSPermissions();

			await permissions.request("screen");
			await permissions.request("accessibility");
			await permissions.request("input-monitoring");
			await permissions.request("apple-events", "com.apple.Safari");

			expect(macPermissionsMock.askForScreenCaptureAccess).toHaveBeenCalledTimes(1);
			expect(macPermissionsMock.askForAccessibilityAccess).toHaveBeenCalledTimes(1);
			expect(macPermissionsMock.askForInputMonitoringAccess).toHaveBeenCalledTimes(1);
			expect(macPermissionsMock.askForAppleEventsAccess).toHaveBeenCalledWith("com.apple.Safari");
		});
	});
});
