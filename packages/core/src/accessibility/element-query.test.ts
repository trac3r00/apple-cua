import { describe, expect, it } from "vitest";

import { describeQuery, matchElements, suggestNearMisses } from "./element-query.js";
import type { AXTreeElement } from "./types.js";

function el(partial: Partial<AXTreeElement> & { id: number; role: string }): AXTreeElement {
	return {
		label: null,
		value: null,
		frame: { x: 0, y: 0, width: 10, height: 10 },
		actions: [],
		children: [],
		...partial,
	};
}

describe("#given a pressable control and decoys sharing its label #when queried #then the pressable control outranks them", () => {
	it("ranks the AXPress button above the static text with the same label", () => {
		const elements = [
			el({ id: 1, role: "AXStaticText", label: "Save", frame: { x: 0, y: 30, width: 40, height: 12 } }),
			el({
				id: 2,
				role: "AXButton",
				label: "Save",
				actions: ["AXPress"],
				frame: { x: 0, y: 60, width: 60, height: 24 },
			}),
		];

		const matches = matchElements(elements, { label: "Save" });

		expect(matches.map((match) => match.element.id)).toEqual([2, 1]);
		expect(matches[0]?.matchedBy).toContain("label");
		expect(matches[0]?.matchedBy).toContain("pressable");
		expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
	});
});

describe("#given role aliases and case differences #when querying by role #then matching ignores the AX prefix and letter case", () => {
	it("matches button to AXButton, axbutton to AXButton, and is case-insensitive", () => {
		const elements = [
			el({ id: 1, role: "AXButton", label: "Open", actions: ["AXPress"] }),
			el({ id: 2, role: "AXTextField", label: "Note", actions: ["AXSetValue"] }),
			el({ id: 3, role: "AXStaticText", value: "Ready" }),
		];

		expect(matchElements(elements, { role: "button" }).map((match) => match.element.id)).toEqual([1]);
		expect(matchElements(elements, { role: "axbutton" }).map((match) => match.element.id)).toEqual([1]);
		expect(matchElements(elements, { role: "TEXTFIELD" }).map((match) => match.element.id)).toEqual([2]);
	});
});

describe("#given whitespace noise in labels #when querying by substring #then matching is normalized", () => {
	it("collapses whitespace and ignores case on both sides", () => {
		const elements = [
			el({ id: 1, role: "AXButton", label: "  Save   As… ", actions: ["AXPress"] }),
			el({ id: 2, role: "AXButton", label: "Open", actions: ["AXPress"] }),
		];

		expect(matchElements(elements, { labelContains: "save as" }).map((match) => match.element.id)).toEqual([1]);
	});
});

describe("#given text that only lives in the value #when querying #then value matches are found and rank below label matches", () => {
	it("finds value text, and prefers the same text when it is the label", () => {
		const elements = [
			el({ id: 5, role: "AXStaticText", value: "Ready" }),
			el({ id: 6, role: "AXStaticText", label: "Ready" }),
		];

		expect(matchElements(elements, { text: "ready" }).map((match) => match.element.id)).toEqual([6, 5]);
		expect(matchElements(elements, { valueContains: "ready" }).map((match) => match.element.id)).toEqual([5]);
	});
});

describe("#given equally scored matches #when ranked #then reading order decides and repeated calls agree", () => {
	it("orders by score, then y, then x, then id", () => {
		const elements = [
			el({
				id: 7,
				role: "AXButton",
				label: "Next",
				actions: ["AXPress"],
				frame: { x: 0, y: 100, width: 20, height: 20 },
			}),
			el({
				id: 8,
				role: "AXButton",
				label: "Next",
				actions: ["AXPress"],
				frame: { x: 50, y: 20, width: 20, height: 20 },
			}),
			el({
				id: 9,
				role: "AXButton",
				label: "Next",
				actions: ["AXPress"],
				frame: { x: 10, y: 20, width: 20, height: 20 },
			}),
		];

		const first = matchElements(elements, { label: "Next" }).map((match) => match.element.id);
		const second = matchElements([...elements].reverse(), { label: "Next" }).map((match) => match.element.id);

		expect(first).toEqual([9, 8, 7]);
		expect(second).toEqual(first);
	});
});

describe("#given nothing matches #when the query misses #then the result is empty and near misses teach the caller what is there", () => {
	const elements = [
		el({
			id: 1,
			role: "AXButton",
			label: "Save As…",
			actions: ["AXPress"],
			frame: { x: 0, y: 10, width: 40, height: 20 },
		}),
		el({
			id: 2,
			role: "AXButton",
			label: "Open",
			actions: ["AXPress"],
			frame: { x: 0, y: 40, width: 40, height: 20 },
		}),
		el({
			id: 3,
			role: "AXButton",
			label: "Close",
			actions: ["AXPress"],
			frame: { x: 0, y: 70, width: 40, height: 20 },
		}),
	];

	it("returns no matches for a label nothing carries", () => {
		expect(matchElements(elements, { label: "Save" })).toEqual([]);
	});

	it("suggests the candidates that share words with the query", () => {
		const misses = suggestNearMisses(elements, { label: "Save Document" }, 3);

		expect(misses.map((element) => element.id)).toEqual([1]);
	});

	it("falls back to the role's own controls in reading order when no words overlap", () => {
		const misses = suggestNearMisses(elements, { role: "button", label: "Zebra" }, 2);

		expect(misses.map((element) => element.id)).toEqual([1, 2]);
	});

	it("returns nothing when there is neither word overlap nor a role to narrow the field", () => {
		expect(suggestNearMisses(elements, { label: "Zebra" }, 3)).toEqual([]);
	});
});

describe("#given a structured query #when described for an answer #then the description names each constraint it carries", () => {
	it("joins the constraints in a fixed order", () => {
		expect(describeQuery({ role: "button", labelContains: "Save" })).toBe('role=button label_contains="Save"');
		expect(describeQuery({ label: "Open", valueContains: "ready" })).toBe('label="Open" value_contains="ready"');
		expect(describeQuery({ text: "hello world" })).toBe('text="hello world"');
	});
});

describe("#given a query with no constraints #when it is matched #then nothing matches and nothing is suggested", () => {
	const elements = [el({ id: 1, role: "AXButton", label: "Open", actions: ["AXPress"] })];

	it("returns no matches for an empty or whitespace-only query", () => {
		expect(matchElements(elements, {})).toEqual([]);
		expect(matchElements(elements, { label: "   " })).toEqual([]);
		expect(suggestNearMisses(elements, {}, 3)).toEqual([]);
	});
});
