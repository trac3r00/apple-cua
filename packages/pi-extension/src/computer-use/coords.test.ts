import { describe, expect, it } from "vitest";

import { resolveDisplayConfig, unscaleCoord } from "./coords.js";

describe("#given a small screen #when resolving display config #then model dimensions pass through", () => {
	it("keeps logical dimensions unchanged", () => {
		const display = resolveDisplayConfig({ width: 1024, height: 700 });

		expect(display).toEqual({ logicalWidth: 1024, logicalHeight: 700, modelWidth: 1024, modelHeight: 700 });
	});
});

describe("#given a large 16:9 screen #when resolving display config #then dimensions fit 1280x720", () => {
	it("downscales while preserving aspect ratio", () => {
		const display = resolveDisplayConfig({ width: 2560, height: 1440 });

		expect(display).toEqual({ logicalWidth: 2560, logicalHeight: 1440, modelWidth: 1280, modelHeight: 720 });
	});
});

describe("#given a large non-16:9 screen #when resolving display config #then the long edge is capped", () => {
	it("preserves aspect ratio against the 1280 long edge", () => {
		const display = resolveDisplayConfig({ width: 2560, height: 1600 });

		expect(display).toEqual({ logicalWidth: 2560, logicalHeight: 1600, modelWidth: 1280, modelHeight: 800 });
	});
});

describe("#given a scaled display #when unscaling model coordinates #then logical points are rounded", () => {
	it("returns rounded logical coordinates", () => {
		const display = { logicalWidth: 2560, logicalHeight: 1440, modelWidth: 1280, modelHeight: 720 };

		const point = unscaleCoord({ x: 640.4, y: 360.4 }, display);

		expect(point).toEqual({ x: 1281, y: 721 });
	});
});

describe("#given an unscaled display #when unscaling model coordinates #then coordinates are idempotent", () => {
	it("returns the same rounded coordinates", () => {
		const display = { logicalWidth: 800, logicalHeight: 600, modelWidth: 800, modelHeight: 600 };

		const point = unscaleCoord({ x: 12.3, y: 45.5 }, display);

		expect(point).toEqual({ x: 12, y: 46 });
	});
});
