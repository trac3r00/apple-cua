import { describe, expect, it } from "vitest";

import {
	captureDisplayRegionImage,
	computeDisplayCrop,
	getMainDisplayId,
	getMainDisplayNativePixelSize,
} from "./screenshot.js";

const FULL_HD = { width: 1920, height: 1080 };
const RETINA = { width: 3840, height: 2160 };

const screenRecordingGranted = ((): boolean => {
	try {
		getMainDisplayNativePixelSize();
		return true;
	} catch {
		return false;
	}
})();

function imageDimensions(data: Buffer, format: "png" | "jpeg"): { readonly width: number; readonly height: number } {
	if (format === "png") {
		if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
			throw new Error("expected PNG bytes");
		}
		return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
	}
	if (data.subarray(0, 2).toString("hex") !== "ffd8") {
		throw new Error("expected JPEG bytes");
	}
	let offset = 2;
	while (offset + 9 < data.byteLength) {
		if (data[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = data[offset + 1] ?? 0;
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
		}
		offset += 2 + data.readUInt16BE(offset + 2);
	}
	throw new Error("no JPEG frame header found");
}

describe("#given a Retina display #when a region is converted to pixels #then the backing scale is applied", () => {
	it("scales the region into image pixels", () => {
		const crop = computeDisplayCrop(
			{ x: 100, y: 50, width: 200, height: 100 },
			{ origin: { x: 0, y: 0 }, size: FULL_HD },
			RETINA,
		);

		expect(crop).toEqual({ x: 200, y: 100, width: 400, height: 200 });
	});

	it("leaves the region unscaled on a non-Retina display", () => {
		const crop = computeDisplayCrop(
			{ x: 100, y: 50, width: 200, height: 100 },
			{ origin: { x: 0, y: 0 }, size: FULL_HD },
			FULL_HD,
		);

		expect(crop).toEqual({ x: 100, y: 50, width: 200, height: 100 });
	});
});

describe("#given a display placed left of the main display #when a region uses global coordinates #then the display origin is subtracted", () => {
	it("converts global points to display-local crop pixels", () => {
		const crop = computeDisplayCrop(
			{ x: -1820, y: 100, width: 100, height: 50 },
			{ origin: { x: -1920, y: 0 }, size: FULL_HD },
			FULL_HD,
		);

		expect(crop).toEqual({ x: 100, y: 100, width: 100, height: 50 });
	});
});

describe("#given a region crossing the display edge #when a crop is computed #then it is clamped to the image", () => {
	it("trims the overflowing edges", () => {
		const crop = computeDisplayCrop(
			{ x: 1800, y: 1000, width: 500, height: 500 },
			{ origin: { x: 0, y: 0 }, size: FULL_HD },
			FULL_HD,
		);

		expect(crop).toEqual({ x: 1800, y: 1000, width: 120, height: 80 });
	});

	it("clamps a region that starts before the display origin", () => {
		const crop = computeDisplayCrop(
			{ x: -40, y: -20, width: 200, height: 200 },
			{ origin: { x: 0, y: 0 }, size: FULL_HD },
			FULL_HD,
		);

		expect(crop).toEqual({ x: 0, y: 0, width: 160, height: 180 });
	});
});

describe("#given an unusable region #when a crop is computed #then a clear error is raised", () => {
	it("rejects a region outside the display", () => {
		expect(() =>
			computeDisplayCrop(
				{ x: 4000, y: 4000, width: 100, height: 100 },
				{ origin: { x: 0, y: 0 }, size: FULL_HD },
				FULL_HD,
			),
		).toThrow(/does not overlap/);
	});

	it("rejects a region whose size is not positive", () => {
		expect(() =>
			computeDisplayCrop({ x: 0, y: 0, width: 0, height: 10 }, { origin: { x: 0, y: 0 }, size: FULL_HD }, FULL_HD),
		).toThrow(/positive size/);
	});

	it("rejects non-finite coordinates", () => {
		expect(() =>
			computeDisplayCrop(
				{ x: Number.NaN, y: 0, width: 10, height: 10 },
				{ origin: { x: 0, y: 0 }, size: FULL_HD },
				FULL_HD,
			),
		).toThrow(/finite/);
	});

	it("rejects an inactive display", () => {
		expect(() =>
			computeDisplayCrop(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
				FULL_HD,
			),
		).toThrow(/not active/);
	});
});

describe("#given screen recording permission #when a display region is captured #then the requested encoding is returned", () => {
	it.skipIf(!screenRecordingGranted)("returns PNG bytes no larger than the requested cap", () => {
		const captured = captureDisplayRegionImage(
			getMainDisplayId(),
			{ x: 0, y: 0, width: 400, height: 300 },
			320,
			320,
			"png",
			72,
		);

		const dimensions = imageDimensions(captured.data, "png");
		expect(dimensions).toEqual({ width: captured.width, height: captured.height });
		expect(captured.width).toBeLessThanOrEqual(320);
		expect(captured.height).toBeLessThanOrEqual(320);
		expect(captured.width / captured.height).toBeCloseTo(400 / 300, 1);
	});

	it.skipIf(!screenRecordingGranted)("does not upscale a region that is smaller than the cap", () => {
		const captured = captureDisplayRegionImage(
			getMainDisplayId(),
			{ x: 0, y: 0, width: 400, height: 100 },
			1_000_000,
			1_000_000,
			"png",
			72,
		);

		const dimensions = imageDimensions(captured.data, "png");
		expect(dimensions).toEqual({ width: captured.width, height: captured.height });
		expect(captured.width / captured.height).toBeCloseTo(4, 1);
	});

	it.skipIf(!screenRecordingGranted)("encodes the same region as JPEG when asked", () => {
		const region = { x: 0, y: 0, width: 600, height: 400 };
		const jpeg = captureDisplayRegionImage(getMainDisplayId(), region, 1200, 1200, "jpeg", 72);

		expect(jpeg.data.subarray(0, 2).toString("hex")).toBe("ffd8");
		const dimensions = imageDimensions(jpeg.data, "jpeg");
		expect(dimensions).toEqual({ width: jpeg.width, height: jpeg.height });
	});

	it.skipIf(!screenRecordingGranted)("rejects an unknown display id", () => {
		expect(() =>
			captureDisplayRegionImage(999_999, { x: 0, y: 0, width: 10, height: 10 }, 100, 100, "png", 72),
		).toThrow(/Screen Recording|display/);
	});
});
