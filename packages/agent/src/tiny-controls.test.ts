import type { AXTreeElement, AppState } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { buildMacActionSpace } from "./action-space.js";

function element(overrides: Partial<AXTreeElement> & { id: number; role: string }): AXTreeElement {
	return {
		label: null,
		value: null,
		frame: { x: 0, y: 0, width: 10, height: 10 },
		actions: [],
		children: [],
		...overrides,
	};
}

function stateWith(elements: AXTreeElement[]): AppState {
	return {
		app: "Browser",
		bundleId: "com.example.Browser",
		pid: 42,
		frontmost: true,
		axAvailable: true,
		elements,
		screenshotBase64: "",
		screenshotWidth: 0,
		screenshotHeight: 0,
		display: { width: 1920, height: 1080, scaleFactor: 2 },
		observationKey: "1:key",
	};
}

describe("#given tiny browser controls #when the action space is built #then advertised actions remain available", () => {
	it("offers a named 4-by-4 control and excludes disabled and duplicate wrappers", () => {
		const space = buildMacActionSpace(
			stateWith([
				element({
					id: 1,
					role: "AXGroup",
					label: "Close tab",
					frame: { x: 0, y: 0, width: 12, height: 12 },
					actions: ["AXPress"],
					children: [2],
				}),
				element({
					id: 2,
					role: "AXButton",
					label: "Close tab",
					frame: { x: 0, y: 0, width: 4, height: 4 },
					actions: ["AXPress"],
				}),
				element({
					id: 3,
					role: "AXButton",
					label: "Disabled tab",
					frame: { x: 0, y: 0, width: 4, height: 4 },
				}),
				element({
					id: 4,
					role: "AXButton",
					label: "Unmute tab",
					frame: { x: 0, y: 0, width: 4, height: 4 },
					actions: ["AXPress"],
				}),
			]),
		);

		expect(space.elements.map((row) => row.index)).toEqual([2, 4]);
		expect(space.targets.PRESS?.[2]).toMatchObject({ label: "Close tab", operation: "PRESS" });
		expect(space.targets.PRESS?.[4]).toMatchObject({ label: "Unmute tab", operation: "PRESS" });
		expect(space.targets.PRESS?.[3]).toBeUndefined();
	});
});
