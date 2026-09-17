import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type OcrTextObservation,
	filterByMinimumConfidence,
	recognizeTextInFile,
	recognizeTextInImage,
} from "./vision.js";

const fixture = (name: string): string => fileURLToPath(new URL(`../../../test/fixtures/${name}`, import.meta.url));

const oneByOne = fixture("ocr-sample-1x.png");
const twoByOne = fixture("ocr-sample-2x.png");

function find(observations: readonly OcrTextObservation[], text: string): OcrTextObservation {
	const hit = observations.find((observation) => observation.text === text);
	if (hit === undefined) {
		throw new Error(
			`${text} was not recognised; saw ${JSON.stringify(observations.map((o) => o.text))}`,
		);
	}
	return hit;
}

function center(box: OcrTextObservation["box"]): { readonly x: number; readonly y: number } {
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

describe.runIf(process.platform === "darwin")(
	"#given a fixture rendered with known text at known anchors #when Vision OCR reads it #then the strings come back with tap-ready pixel boxes",
	() => {
		it("recognises every line the generator drew, in image pixel space with a top-left origin", () => {
			const observations = recognizeTextInFile(oneByOne);

			const first = find(observations, "ZQX-4471");
			const second = find(observations, "Settings");
			const third = find(observations, "Wi-Fi");

			expect(first.confidence).toBeGreaterThan(0.5);
			// The generator drew ZQX-4471 with its baseline 110px from the top of an 800x400 image.
			// A bottom-left origin (Vision's own convention) would land it near y=290 instead.
			const firstCenter = center(first.box);
			expect(firstCenter.x).toBeGreaterThan(60);
			expect(firstCenter.x).toBeLessThan(280);
			expect(firstCenter.y).toBeGreaterThan(60);
			expect(firstCenter.y).toBeLessThan(130);
			expect(first.box.width).toBeGreaterThan(100);

			// Top-to-bottom reading order is what the top-left conversion has to preserve.
			expect(center(second.box).y).toBeGreaterThan(firstCenter.y);
			expect(center(third.box).y).toBeGreaterThan(center(second.box).y);
		});

		it("reports pixel coordinates, so the same layout at backing scale 2 doubles every box", () => {
			const first = find(recognizeTextInFile(oneByOne), "ZQX-4471");
			const firstAt2x = find(recognizeTextInFile(twoByOne), "ZQX-4471");

			expect(firstAt2x.box.width / first.box.width).toBeGreaterThan(1.9);
			expect(firstAt2x.box.width / first.box.width).toBeLessThan(2.1);
			const ratio = center(firstAt2x.box).y / center(first.box).y;
			expect(ratio).toBeGreaterThan(1.9);
			expect(ratio).toBeLessThan(2.1);
		});

		it("reads the same fixture from raw bytes as it does from a path", () => {
			const fromPath = recognizeTextInFile(oneByOne)
				.map((observation) => observation.text)
				.sort();
			const fromBytes = recognizeTextInImage(readFileSync(oneByOne))
				.map((observation) => observation.text)
				.sort();

			expect(fromBytes).toEqual(fromPath);
		});
	},
);

describe("#given observations of mixed confidence #when the minimum-confidence filter runs #then only the confident ones survive", () => {
	const observations: readonly OcrTextObservation[] = [
		{ text: "blurry", confidence: 0.2, box: { x: 0, y: 0, width: 10, height: 10 } },
		{ text: "sharp", confidence: 0.8, box: { x: 20, y: 0, width: 10, height: 10 } },
	];

	it("drops observations below the minimum and keeps the boundary value", () => {
		expect(filterByMinimumConfidence(observations, 0.5).map((observation) => observation.text)).toEqual(["sharp"]);
		expect(filterByMinimumConfidence(observations, 0.2)).toHaveLength(2);
		expect(filterByMinimumConfidence(observations, 0.9)).toHaveLength(0);
	});

	it("returns the observations untouched when no minimum is asked for", () => {
		expect(filterByMinimumConfidence(observations, undefined)).toBe(observations);
	});
});

describe.runIf(process.platform === "darwin")(
	"#given bytes that are not an image #when Vision OCR is asked to read them #then it refuses instead of reporting an empty screen",
	() => {
		it("throws a decode error naming the input", () => {
			expect(() => recognizeTextInImage(Buffer.from("this is not a png"))).toThrow(/decode/i);
		});
	},
);
