import { describe, expect, it, vi } from "vitest";

const getWindowsMock = vi.hoisted(() => ({
	activeWindow: vi.fn<() => Promise<unknown>>(),
	openWindows: vi.fn<() => Promise<readonly unknown[]>>(),
}));

vi.mock("get-windows", () => getWindowsMock);

describe("#given macos windows", () => {
	describe("#when listing windows", () => {
		it("#then maps get-windows results to window info", async () => {
			const { MacOSWindows } = await import("./macos.js");
			const windows = new MacOSWindows();
			getWindowsMock.openWindows.mockResolvedValue([
				{
					bounds: { height: 768, width: 1024, x: 10, y: 20 },
					id: 42,
					owner: { bundleId: "com.apple.Safari", processId: 123 },
					title: "Example",
					url: "https://example.com",
				},
			]);

			await expect(windows.list()).resolves.toEqual([
				{
					bounds: { height: 768, width: 1024, x: 10, y: 20 },
					bundleId: "com.apple.Safari",
					id: 42,
					processId: 123,
					title: "Example",
					url: "https://example.com",
				},
			]);
		});
	});

	describe("#when reading the active window", () => {
		it("#then returns null when get-windows has no active window", async () => {
			const { MacOSWindows } = await import("./macos.js");
			const windows = new MacOSWindows();
			getWindowsMock.activeWindow.mockResolvedValue(undefined);

			await expect(windows.active()).resolves.toBeNull();
		});

		it("#then maps the active get-windows result", async () => {
			const { MacOSWindows } = await import("./macos.js");
			const windows = new MacOSWindows();
			getWindowsMock.activeWindow.mockResolvedValue({
				bounds: { height: 600, width: 800, x: 5, y: 15 },
				id: 7,
				owner: { bundleId: "com.apple.Terminal", processId: 99 },
				title: "Terminal",
			});

			await expect(windows.active()).resolves.toEqual({
				bounds: { height: 600, width: 800, x: 5, y: 15 },
				bundleId: "com.apple.Terminal",
				id: 7,
				processId: 99,
				title: "Terminal",
			});
		});
	});
});
