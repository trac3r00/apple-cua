import { describe, expect, it, vi } from "vitest";

const overlayMock = vi.hoisted(() => ({
	createCursorOverlay: vi.fn(() => ({
		set: vi.fn(),
		highlight: vi.fn(),
		setMode: vi.fn(),
		hide: vi.fn(),
		close: vi.fn(),
	})),
}));

vi.mock("./macos-ffi/cursor-overlay.js", async () => {
	const actual = await vi.importActual<typeof import("./macos-ffi/cursor-overlay.js")>(
		"./macos-ffi/cursor-overlay.js",
	);
	return { ...actual, createCursorOverlay: overlayMock.createCursorOverlay };
});

describe("#given host cursor overlay policy", () => {
	it("#when background delivery has no injected overlay #then it does not create a default overlay", async () => {
		const { MacOSHostComputer } = await import("./macos.js");

		const host = new MacOSHostComputer({ delivery: "background" });

		expect(overlayMock.createCursorOverlay).not.toHaveBeenCalled();
		await host.close();
	});

	it("#when attended delivery has no injected overlay #then it retains default cursor creation", async () => {
		const { MacOSHostComputer } = await import("./macos.js");

		const host = new MacOSHostComputer({ delivery: "attended" });

		expect(overlayMock.createCursorOverlay).toHaveBeenCalledOnce();
		await host.close();
	});
});
