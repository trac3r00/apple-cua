import { beforeEach, describe, expect, it, vi } from "vitest";

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
	beforeEach(() => {
		overlayMock.createCursorOverlay.mockClear();
	});

	it("#when background delivery has cues enabled by default #then it creates the default drawn-marker overlay", async () => {
		const { MacOSHostComputer } = await import("./macos.js");

		const host = new MacOSHostComputer({ delivery: "background" });

		expect(overlayMock.createCursorOverlay).toHaveBeenCalledOnce();
		await host.close();
	});

	it("#when background delivery has background cues disabled #then it does not create a default overlay", async () => {
		const { MacOSHostComputer } = await import("./macos.js");
		const previous = process.env["APPLE_CUA_CURSOR_BACKGROUND_CUES"];
		process.env["APPLE_CUA_CURSOR_BACKGROUND_CUES"] = "off";
		try {
			const host = new MacOSHostComputer({ delivery: "background" });

			expect(overlayMock.createCursorOverlay).not.toHaveBeenCalled();
			await host.close();
		} finally {
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "APPLE_CUA_CURSOR_BACKGROUND_CUES");
			} else {
				process.env["APPLE_CUA_CURSOR_BACKGROUND_CUES"] = previous;
			}
		}
	});

	it("#when attended delivery has no injected overlay #then it retains default cursor creation", async () => {
		const { MacOSHostComputer } = await import("./macos.js");

		const host = new MacOSHostComputer({ delivery: "attended" });

		expect(overlayMock.createCursorOverlay).toHaveBeenCalledOnce();
		await host.close();
	});

	it("#when an overlay is injected #then it is used in either delivery", async () => {
		const { MacOSHostComputer } = await import("./macos.js");
		const overlay = {
			state: vi.fn(async () => null),
			set: vi.fn(),
			highlight: vi.fn(),
			setMode: vi.fn(),
			hide: vi.fn(),
			close: vi.fn(),
		};

		new MacOSHostComputer({ delivery: "background", overlay });
		expect(overlayMock.createCursorOverlay).not.toHaveBeenCalled();
	});
});
