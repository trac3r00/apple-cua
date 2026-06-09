import { describe, expect, it } from "vitest";

import {
	MAX_SCREENSHOT_LONG_EDGE,
	type ScreenshotViewport,
	resolveWindowScreenshotSize,
	screenRectToScreenshot,
	screenshotPointToScreen,
} from "./viewport.js";

describe("#given a window smaller than the cap #when resolving screenshot size #then dimensions pass through", () => {
	it("keeps the window dimensions unchanged", () => {
		expect(resolveWindowScreenshotSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
	});
});

describe("#given a window larger than the cap #when resolving screenshot size #then the long edge is capped", () => {
	it("preserves the window aspect ratio against the 1280 long edge", () => {
		expect(resolveWindowScreenshotSize({ width: 2560, height: 1600 })).toEqual({ width: 1280, height: 800 });
	});

	it("caps a tall window by its height", () => {
		expect(resolveWindowScreenshotSize({ width: 1000, height: 2560 })).toEqual({ width: 500, height: 1280 });
	});

	it("never collapses a thin window below one pixel", () => {
		const size = resolveWindowScreenshotSize({ width: 4000, height: 2 });

		expect(size.width).toBe(MAX_SCREENSHOT_LONG_EDGE);
		expect(size.height).toBe(1);
	});
});

describe("#given an invalid window size #when resolving screenshot size #then it throws", () => {
	it("rejects non-positive dimensions", () => {
		expect(() => resolveWindowScreenshotSize({ width: 0, height: 600 })).toThrow();
		expect(() => resolveWindowScreenshotSize({ width: 800, height: Number.NaN })).toThrow();
	});
});

describe("#given a window screenshot viewport #when mapping a screenshot pixel #then it lands at the window-relative screen point", () => {
	it("applies window origin offset and window-to-screenshot scale", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		};

		// Pixel (250, 200) is the centre of the 500x400 screenshot.
		expect(screenshotPointToScreen({ x: 250, y: 200 }, viewport)).toEqual({ x: 800, y: 550 });
		// The screenshot origin maps to the window origin.
		expect(screenshotPointToScreen({ x: 0, y: 0 }, viewport)).toEqual({ x: 300, y: 150 });
	});

	it("is the identity when the screenshot matches an origin window pixel-for-pixel", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 0, y: 0, width: 100, height: 80 },
			screenshotWidth: 100,
			screenshotHeight: 80,
		};

		expect(screenshotPointToScreen({ x: 10, y: 20 }, viewport)).toEqual({ x: 10, y: 20 });
	});

	it("rounds to the nearest logical point", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 0, y: 0, width: 2560, height: 1440 },
			screenshotWidth: 1280,
			screenshotHeight: 720,
		};

		expect(screenshotPointToScreen({ x: 640.4, y: 360.4 }, viewport)).toEqual({ x: 1281, y: 721 });
	});

	it("keeps logical points in HiDPI windows free of backing-scale leakage", () => {
		// A 1440x900pt Retina window captured at its native aspect, capped to 1280.
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 100, y: 50, width: 1440, height: 900 },
			screenshotWidth: 1280,
			screenshotHeight: 800,
		};

		expect(screenshotPointToScreen({ x: 1280, y: 800 }, viewport)).toEqual({ x: 1540, y: 950 });
	});

	it("maps windows on a secondary display with a negative origin", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: -1920, y: -200, width: 960, height: 600 },
			screenshotWidth: 960,
			screenshotHeight: 600,
		};

		expect(screenshotPointToScreen({ x: 480, y: 300 }, viewport)).toEqual({ x: -1440, y: 100 });
	});

	it("clamps screenshot pixels that fall outside the image back into the window rect", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 0, y: 0, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		};

		expect(screenshotPointToScreen({ x: -50, y: -10 }, viewport)).toEqual({ x: 0, y: 0 });
		expect(screenshotPointToScreen({ x: 600, y: 500 }, viewport)).toEqual({ x: 1000, y: 800 });
	});
});

describe("#given a window screenshot viewport #when mapping an accessibility frame #then it lands in screenshot pixel space", () => {
	it("is the inverse of screenshotPointToScreen for the rect origin", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		};

		expect(screenRectToScreenshot({ x: 800, y: 550, width: 200, height: 160 }, viewport)).toEqual({
			x: 250,
			y: 200,
			width: 100,
			height: 80,
		});
	});

	it("applies independent x and y scales for non-square downscales", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 0, y: 0, width: 1000, height: 400 },
			screenshotWidth: 250,
			screenshotHeight: 200,
		};

		expect(screenRectToScreenshot({ x: 400, y: 100, width: 200, height: 80 }, viewport)).toEqual({
			x: 100,
			y: 50,
			width: 50,
			height: 40,
		});
	});

	it("maps frames of windows on a secondary display with a negative origin", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: -1920, y: -200, width: 960, height: 600 },
			screenshotWidth: 960,
			screenshotHeight: 600,
		};

		expect(screenRectToScreenshot({ x: -1440, y: 100, width: 96, height: 60 }, viewport)).toEqual({
			x: 480,
			y: 300,
			width: 96,
			height: 60,
		});
	});

	it("round-trips a frame origin through screenshotPointToScreen", () => {
		const viewport: ScreenshotViewport = {
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		};
		const pixel = screenRectToScreenshot({ x: 700, y: 470, width: 10, height: 10 }, viewport);

		expect(screenshotPointToScreen({ x: pixel.x, y: pixel.y }, viewport)).toEqual({ x: 700, y: 470 });
	});
});
