import { describe, expect, it } from "vitest";
import { stepSchema } from "./protocol.js";

describe("select step contract", () => {
	it("#given a described combobox and a label #when parsed #then keeps both target and choice", () => {
		const step = stepSchema.parse({
			action: "select",
			target: { role: "combobox", name: "Country" },
			choice: { label: "Canada" },
		});
		expect(step).toEqual({
			action: "select",
			target: { role: "combobox", name: "Country" },
			choice: { label: "Canada" },
		});
	});

	it("#given a ref and an option value #when parsed #then accepts the value choice", () => {
		expect(stepSchema.parse({ action: "select", ref: 3, choice: { value: "ca" } })).toEqual({
			action: "select",
			ref: 3,
			choice: { value: "ca" },
		});
	});

	it.each([
		["no choice", {}],
		["two choices", { value: "ca", label: "Canada" }],
		["a fractional index", { index: 1.5 }],
		["an unknown choice field", { text: "Canada" }],
	] as const)("#given %s #when parsed #then refuses the select step", (_name, choice) => {
		expect(
			stepSchema.safeParse({ action: "select", target: { role: "combobox", name: "Country" }, choice }).success,
		).toBe(false);
	});
});
