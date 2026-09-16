import { describe, expect, it } from "vitest";
import type { AXUIElementRef } from "./macos-ffi/accessibility.js";
import { type MenuAccessibility, chooseMenuAction, invokeMenu } from "./macos-menu.js";

interface MenuNode {
	readonly role: string;
	readonly title?: string;
	readonly enabled?: boolean;
	readonly actions?: readonly string[];
	readonly children?: readonly MenuNode[];
}

describe("invokeMenu #given a live native menu hierarchy #when an exact path is invoked #then every hop resolves and acts in order", () => {
	it("flattens transparent AXMenu containers and uses the preferred action", async () => {
		const menu = node("AXMenuBar", undefined, [
			node("AXMenuBarItem", "File", [node("AXMenu", undefined, [node("AXMenuItem", "Open", [])])]),
		]);
		const fake = fakeAccessibility(menu);

		const result = await invokeMenu(42, [" File ", "Open"], fake.accessibility);

		expect(result).toEqual({ resolvedPath: ["File", "Open"], action: "AXPress" });
		expect(fake.performed).toEqual(["File:AXPress", "Open:AXPress"]);
		expect(fake.delays).toEqual([80]);
	});
});

describe("invokeMenu #given duplicate exact titles #when resolving a hop #then ambiguity is refused", () => {
	it("reports the failed hop and does not invoke either ambiguous item", async () => {
		const menu = node("AXMenuBar", undefined, [
			node("AXMenuBarItem", "File", [
				node("AXMenu", undefined, [node("AXMenuItem", "Open", []), node("AXMenuItem", "Open", [])]),
			]),
		]);
		const fake = fakeAccessibility(menu);

		await expect(invokeMenu(42, ["File", "Open"], fake.accessibility)).rejects.toThrow(
			'invoke_menu: path segment 1 ("Open") is ambiguous; failed at hop 1',
		);
		expect(fake.performed).toEqual(["File:AXPress"]);
	});
});

describe("chooseMenuAction #given several native actions #when selecting one #then documented priority wins", () => {
	it("prefers AXPress, AXPick, AXShowMenu, then AXOpen", () => {
		expect(chooseMenuAction(["AXOpen", "AXShowMenu", "AXPick"])).toBe("AXPick");
		expect(chooseMenuAction(["AXOpen"])).toBe("AXOpen");
		expect(chooseMenuAction([])).toBeUndefined();
	});
});

function node(role: string, title: string | undefined, children: readonly MenuNode[]): MenuNode {
	return { role, ...(title === undefined ? {} : { title }), enabled: true, actions: ["AXPress"], children };
}

function fakeAccessibility(menuBar: MenuNode): {
	readonly accessibility: MenuAccessibility;
	readonly performed: string[];
	readonly delays: number[];
} {
	const application: MenuNode = { role: "AXApplication" };
	const performed: string[] = [];
	const delays: number[] = [];
	const reference = (value: MenuNode): AXUIElementRef => value;
	return {
		performed,
		delays,
		accessibility: {
			createApplication: () => reference(application),
			elementAttribute: (element, attribute) =>
				element === application && attribute === "AXMenuBar" ? reference(menuBar) : null,
			copyChildren: (element) => ((element as MenuNode).children ?? []).map(reference),
			stringAttribute: (element, attribute) => {
				const item = element as MenuNode;
				return attribute === "AXRole" ? item.role : attribute === "AXTitle" ? (item.title ?? null) : null;
			},
			booleanAttribute: (element, attribute) =>
				attribute === "AXEnabled" ? ((element as MenuNode).enabled ?? null) : null,
			actionNames: (element) => [...((element as MenuNode).actions ?? [])],
			perform: (element, action) => performed.push(`${(element as MenuNode).title ?? ""}:${action}`),
			release: () => undefined,
			delay: async (milliseconds) => {
				delays.push(milliseconds);
			},
		},
	};
}
