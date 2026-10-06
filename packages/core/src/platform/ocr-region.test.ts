import { describe, expect, it } from "vitest";
import { OCR_REGION_PADDING_POINTS, resolveOcrCrop } from "./ocr-region.js";

const window = { x: 529, y: 190, width: 920, height: 464 };
const retina = { width: 1840, height: 928 };

describe("resolveOcrCrop #given a region in global screen points #when the capture is Retina #then it names whole capture pixels", () => {
	it("maps window-local points to pixels by the capture's own scale, offsetting by the window origin", () => {
		const region = { x: 729, y: 290, width: 400, height: 200 };

		const crop = resolveOcrCrop(region, window, retina, 0);

		expect(crop).toEqual({ x: 400, y: 200, width: 800, height: 400 });
	});

	it("widens the region by the padding on every side before cutting", () => {
		const region = { x: 729, y: 290, width: 400, height: 200 };

		const crop = resolveOcrCrop(region, window, retina, 4);

		expect(crop).toEqual({ x: 392, y: 192, width: 816, height: 416 });
	});

	it("uses a different scale on each axis when the capture was capped unevenly", () => {
		const crop = resolveOcrCrop({ x: 529, y: 190, width: 460, height: 232 }, window, { width: 460, height: 464 }, 0);

		expect(crop).toEqual({ x: 0, y: 0, width: 230, height: 232 });
	});

	it("rounds outward, so a fractional edge never cuts a boundary pixel off", () => {
		const crop = resolveOcrCrop({ x: 529.25, y: 190.25, width: 10.3, height: 10.3 }, window, retina, 0);

		expect(crop).toEqual({ x: 0, y: 0, width: 22, height: 22 });
	});
});

describe("resolveOcrCrop #given a padded region that leaves the window #when it is cut #then it is clamped to the capture", () => {
	it("clamps a region hanging past every edge of the window to the whole capture", () => {
		const crop = resolveOcrCrop({ x: 0, y: 0, width: 5000, height: 5000 }, window, retina);

		expect(crop).toEqual({ x: 0, y: 0, width: 1840, height: 928 });
	});

	it("clamps the padding at the window edge instead of reaching outside it", () => {
		const region = { x: 529 + 2, y: 190 + 2, width: 100, height: 100 };

		const crop = resolveOcrCrop(region, window, retina, OCR_REGION_PADDING_POINTS);

		expect(crop?.x).toBe(0);
		expect(crop?.y).toBe(0);
		expect(crop?.width).toBe((2 + 100 + OCR_REGION_PADDING_POINTS) * 2);
	});

	it("is undefined when the region and its padding lie wholly outside the window", () => {
		expect(resolveOcrCrop({ x: 2000, y: 200, width: 100, height: 100 }, window, retina)).toBeUndefined();
		expect(resolveOcrCrop({ x: 529, y: 0, width: 100, height: 100 }, window, retina)).toBeUndefined();
	});

	it("keeps text whose box straddles the region edge inside the cut, within the padding", () => {
		// A row whose box starts 5 points left of the region: still inside the default 8-point padding.
		const region = { x: 729, y: 290, width: 400, height: 200 };
		const straddling = { x: 724, y: 300, width: 40, height: 14 };

		const crop = resolveOcrCrop(region, window, retina);

		const left = straddling.x - window.x;
		expect(crop).toBeDefined();
		expect((crop?.x ?? Number.POSITIVE_INFINITY) / 2).toBeLessThanOrEqual(left);
	});
});
