import { describe, expect, it } from "vitest";
import { parseVisualAnalysis, visualAnalysisPrompt } from "./visual-analysis.js";

function element(
	label: string,
	x: number,
	y: number,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		label,
		role: "button",
		interaction: "click",
		confidence: 0.8,
		frame: { x, y, width: 20, height: 10 },
		...overrides,
	};
}

function response(elements: unknown[], coverage = { top: true, middle: true, bottom: true }): string {
	return JSON.stringify({ elements, coverage, truncated: false });
}

describe("#given visual analysis output #when parsing #then only bounded image findings are accepted", () => {
	it("covers top, middle, and bottom, including icon-only controls and static text", () => {
		const parsed = parseVisualAnalysis(
			response([
				element("Back", 10, 10, { role: "icon-only button" }),
				element("Account name", 30, 400, { role: "static text", interaction: "none" }),
				element("Submit", 40, 780),
			]),
			100,
			800,
		);

		expect(parsed.coverage).toEqual({ top: true, middle: true, bottom: true });
		expect(parsed.elements.map(({ label, interaction }) => [label, interaction])).toEqual([
			["Back", "click"],
			["Account name", "none"],
			["Submit", "click"],
		]);
	});

	it("sorts findings in reading order by vertical then horizontal position", () => {
		const parsed = parseVisualAnalysis(
			response([element("lower", 0, 20), element("right", 20, 0), element("left", 0, 0)]),
			100,
			100,
		);
		expect(parsed.elements.map(({ label }) => label)).toEqual(["left", "right", "lower"]);
	});

	it("accepts empty results, overlapping boxes, and uncertain interactions", () => {
		const empty = parseVisualAnalysis(response([]), 100, 100);
		const overlap = parseVisualAnalysis(
			response([element("maybe", 0, 0, { interaction: "unknown", confidence: 0.2 }), element("overlap", 10, 0)]),
			100,
			100,
		);
		expect(empty.elements).toEqual([]);
		expect(overlap.elements).toHaveLength(2);
		expect(overlap.elements[0]?.interaction).toBe("unknown");
	});

	it("accepts one fenced JSON answer", () => {
		const parsed = parseVisualAnalysis(`\`\`\`json\n${response([])}\n\`\`\``, 100, 100);
		expect(parsed.elements).toEqual([]);
	});

	it("rejects malformed JSON and prose surrounding JSON", () => {
		expect(() => parseVisualAnalysis("{", 100, 100)).toThrow();
		expect(() => parseVisualAnalysis(`Answer: ${response([])}`, 100, 100)).toThrow();
	});

	it("rejects nonpositive or nonfinite image dimensions", () => {
		for (const [width, height] of [
			[0, 100],
			[-1, 100],
			[Number.NaN, 100],
			[100, Number.POSITIVE_INFINITY],
		] as const) {
			expect(() => parseVisualAnalysis(response([]), width, height)).toThrow();
			expect(() => visualAnalysisPrompt(width, height)).toThrow();
		}
	});

	it("rejects out-of-bounds and nonpositive frames", () => {
		expect(() => parseVisualAnalysis(response([element("outside", 90, 0)]), 100, 100)).toThrow();
		expect(() =>
			parseVisualAnalysis(
				response([element("zero", 0, 0, { frame: { x: 0, y: 0, width: 0, height: 1 } })]),
				100,
				100,
			),
		).toThrow();
	});

	it("rejects nonfinite confidence and oversized element lists", () => {
		expect(() =>
			parseVisualAnalysis(response([element("infinite", 0, 0, { confidence: Number.POSITIVE_INFINITY })]), 100, 100),
		).toThrow();
		expect(() =>
			parseVisualAnalysis(
				response(Array.from({ length: 501 }, (_, index) => element(String(index), 0, 0))),
				100,
				100,
			),
		).toThrow();
	});

	it("rejects oversized output and overlong labels", () => {
		expect(() => parseVisualAnalysis(" ".repeat(512_001), 100, 100)).toThrow();
		expect(() => parseVisualAnalysis(response([element("x".repeat(201), 0, 0)]), 100, 100)).toThrow();
	});
});
