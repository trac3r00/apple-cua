import type { AppState } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { observedActionCompleteResult } from "./result.js";

const state: AppState = {
	app: "Fixture",
	bundleId: "test.fixture",
	pid: 1234,
	frontmost: true,
	axAvailable: true,
	elements: [],
	screenshotBase64: "",
	screenshotWidth: 100,
	screenshotHeight: 100,
	display: { width: 100, height: 100, scaleFactor: 1 },
};

describe("#given observed action state #when formatted #then observation is not inferred action success", () => {
	it.each([
		{ summary: undefined, expected: "unavailable" },
		{ summary: { added: 0, removed: 0, changed: 0 }, expected: "unchanged" },
		{ summary: { added: 1, removed: 0, changed: 0 }, expected: "changed" },
		{ summary: { added: 0, removed: 1, changed: 0 }, expected: "changed" },
		{ summary: { added: 0, removed: 0, changed: 1 }, expected: "changed" },
	])("reports $expected without inventing an outcome", ({ summary, expected }) => {
		const result = observedActionCompleteResult({
			...state,
			...(summary === undefined ? {} : { axChangeSummary: summary }),
		});
		const text = result.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
		const payload: unknown = JSON.parse(text.slice(text.indexOf("{")));
		expect(payload).toHaveProperty("observationStatus", expected);
		expect(payload).not.toHaveProperty("actionSucceeded");
	});
});
