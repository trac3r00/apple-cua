import type { MirroringObservation } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { buildPhoneActionSpace } from "./phone-space.js";

function observation(texts: MirroringObservation["texts"]): MirroringObservation {
	return {
		state: "ready",
		window: { id: 11, x: 0, y: 0, width: 400, height: 800 },
		imageWidth: 400,
		imageHeight: 800,
		texts,
	};
}

const text = (value: string, overrides: Partial<MirroringObservation["texts"][number]> = {}) => ({
	text: value,
	confidence: 0.9,
	x: 10,
	y: 20,
	width: 80,
	height: 24,
	...overrides,
});

describe("buildPhoneActionSpace", () => {
	it("#given OCR strings with tap-ready centres #when the table is built #then each string is an indexed target", () => {
		const space = buildPhoneActionSpace(observation([text("Messages"), text("Photos")]));

		expect(space.platform).toBe("ios");
		expect(space.elements.map((row) => row.label)).toStrictEqual(["Messages", "Photos"]);
		expect(space.targets.PRESS?.[1]?.expectLabel).toBe("Photos");
		expect(space.operations).toContain("PRESS");
		expect(space.sparse).toBe(false);
	});

	it("#given a screen OCR read nothing from #when the table is built #then it reports itself as sparse", () => {
		const space = buildPhoneActionSpace(observation([]));

		expect(space.sparse).toBe(true);
		expect(space.targets.PRESS).toBeUndefined();
	});

	it("#given blank and confidence-poor strings #when the table is built #then they are not offered as choices", () => {
		const space = buildPhoneActionSpace(
			observation([text("   "), text("Maybe", { confidence: 0.1 }), text("Send")]),
			{
				minConfidence: 0.5,
			},
		);

		expect(space.elements.map((row) => row.label)).toStrictEqual(["Send"]);
	});

	it("#given more strings than the budget #when the table is built #then it truncates and says so", () => {
		const many = Array.from({ length: 5 }, (_, index) => text(`Row ${index}`));
		const space = buildPhoneActionSpace(observation(many), { maxTargets: 2 });

		expect(space.elements).toHaveLength(2);
		expect(space.truncated).toBe(true);
	});
});
