import type { AXTreeElement, AppState } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { buildMacActionSpace, targetedOperationsFor } from "./action-space.js";

function element(overrides: Partial<AXTreeElement> & { id: number }): AXTreeElement {
	return {
		role: "AXButton",
		label: null,
		value: null,
		frame: { x: 0, y: 0, width: 40, height: 24 },
		actions: [],
		children: [],
		...overrides,
	};
}

function stateWith(elements: AXTreeElement[]): AppState {
	return {
		app: "TextEdit",
		bundleId: "com.apple.TextEdit",
		pid: 42,
		frontmost: false,
		axAvailable: true,
		elements,
		screenshotBase64: "",
		screenshotWidth: 0,
		screenshotHeight: 0,
		display: { width: 1920, height: 1080, scaleFactor: 2 },
		observationKey: "1:key",
	};
}

describe("buildMacActionSpace", () => {
	it("#given a button, a text area and a hidden element #when the table is built #then only reachable controls are offered", () => {
		const space = buildMacActionSpace(
			stateWith([
				element({ id: 0, role: "AXButton", label: "Save", actions: ["AXPress"] }),
				element({ id: 1, role: "AXTextArea", label: "Document", frame: { x: 0, y: 0, width: 600, height: 400 } }),
				element({
					id: 2,
					role: "AXButton",
					label: "Invisible",
					frame: { x: 0, y: 0, width: 0, height: 0 },
					actions: ["AXPress"],
				}),
			]),
		);

		expect(space.elements.map((row) => row.index)).toStrictEqual([0, 1]);
		expect(space.targets.PRESS?.[0]?.label).toBe("Save");
		expect(space.targets.TYPE_TEXT?.[1]?.label).toBe("Document");
		expect(space.operations).toStrictEqual(["PRESS", "TYPE_TEXT"]);
		expect(space.sparse).toBe(false);
	});

	it("#given a button the app does not let anyone press #when operations are derived #then it is not offered as pressable", () => {
		const operations = targetedOperationsFor(element({ id: 0, role: "AXButton", label: "Disabled", actions: [] }));

		expect(operations).toStrictEqual([]);
	});

	it("#given a checkbox with a value #when operations are derived #then it is never a place to type", () => {
		const operations = targetedOperationsFor(
			element({ id: 0, role: "AXCheckBox", label: "Wrap", value: "1", actions: ["AXPress"] }),
		);

		expect(operations).toStrictEqual(["PRESS"]);
	});

	it("#given a named row wrapping a box of the same name #when the table is built #then only the inner choice is offered", () => {
		const space = buildMacActionSpace(
			stateWith([
				element({
					id: 0,
					role: "AXGroup",
					label: "HJDM",
					frame: { x: 0, y: 0, width: 200, height: 40 },
					actions: ["AXPress"],
					children: [1],
				}),
				element({ id: 1, role: "AXButton", label: "HJDM", actions: ["AXPress"] }),
			]),
		);

		expect(space.elements.map((row) => row.index)).toStrictEqual([1]);
		expect(space.pruned).toBe(1);
	});

	it("#given an unnamed pressable group that wraps nothing #when the table is built #then it is dropped and counted", () => {
		const space = buildMacActionSpace(
			stateWith([
				element({ id: 0, role: "AXGroup", label: null, actions: ["AXPress"], children: [] }),
				element({ id: 1, role: "AXButton", label: "Go", actions: ["AXPress"] }),
			]),
		);

		expect(space.pruned).toBe(1);
		expect(space.elements.map((row) => row.index)).toStrictEqual([1]);
	});

	it("#given an unnamed icon-only button #when the table is built #then it stays a choice", () => {
		const space = buildMacActionSpace(
			stateWith([element({ id: 0, role: "AXButton", label: null, actions: ["AXPress"] })]),
		);

		expect(space.elements.map((row) => row.index)).toStrictEqual([0]);
		expect(space.targets.PRESS?.[0]?.label).toBe("Button");
	});

	it("#given more pressable controls than the budget #when the table is built #then the named ones survive and truncation is reported", () => {
		const many = Array.from({ length: 6 }, (_, index) =>
			element({ id: index, role: "AXButton", label: index < 2 ? `Named ${index}` : null, actions: ["AXPress"] }),
		);
		const space = buildMacActionSpace(stateWith(many), { maxTargetsPerOperation: 3 });

		expect(Object.keys(space.targets.PRESS ?? {})).toHaveLength(3);
		expect(space.targets.PRESS?.[0]?.label).toBe("Named 0");
		expect(space.truncated).toBe(true);
	});

	it("#given static text around the controls #when the table is built #then it travels as context and not as a choice", () => {
		const space = buildMacActionSpace(
			stateWith([
				element({ id: 0, role: "AXStaticText", label: "Meeting notes" }),
				element({ id: 1, role: "AXButton", label: "Save", actions: ["AXPress"] }),
			]),
		);

		expect(space.visibleText).toStrictEqual(["Meeting notes"]);
		expect(space.elements.map((row) => row.index)).toStrictEqual([1]);
	});

	it("#given a screen with nothing to press #when the table is built #then it reports itself as sparse", () => {
		const space = buildMacActionSpace(stateWith([element({ id: 0, role: "AXStaticText", label: "Loading…" })]));

		expect(space.sparse).toBe(true);
		expect(space.operations).toStrictEqual([]);
	});

	it("#given a chosen target #when it is resolved #then it carries the identity the executor must find again", () => {
		const space = buildMacActionSpace(
			stateWith([element({ id: 7, role: "AXButton", label: "Save", actions: ["AXPress"] })]),
		);

		expect(space.targets.PRESS?.[7]).toMatchObject({
			index: 7,
			expectLabel: "Save",
			expectRole: "AXButton",
			operation: "PRESS",
		});
	});
});
