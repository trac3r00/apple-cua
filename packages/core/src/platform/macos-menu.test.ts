import { describe, expect, it } from "vitest";
import type { AXUIElementRef } from "./macos-ffi/accessibility.js";
import {
	type MenuAccessibility,
	type WindowMenuRunner,
	chooseMenuAction,
	findMenuKeyEquivalent,
	invokeMenu,
	invokeWindowMenu,
	planBackgroundKeyEquivalent,
	waitForKeyEquivalentEnabled,
} from "./macos-menu.js";

interface MenuNode {
	readonly role: string;
	readonly title?: string;
	readonly enabled?: boolean;
	readonly actions?: readonly string[];
	readonly children?: readonly MenuNode[];
	readonly cmdChar?: string;
	readonly cmdModifiers?: number;
	readonly frontmost?: boolean;
}

describe("invokeMenu #given a live native menu hierarchy #when an exact path is invoked #then every hop resolves and acts in order", () => {
	it("flattens transparent AXMenu containers and uses the preferred action", async () => {
		const menu = node("AXMenuBar", undefined, [
			node("AXMenuBarItem", "File", [node("AXMenu", undefined, [node("AXMenuItem", "Open", [])])]),
		]);
		const fake = fakeAccessibility(menu);

		const result = await invokeMenu(42, [" File ", "Open"], fake.accessibility);

		expect(result).toEqual({ resolvedPath: ["File", "Open"], action: "AXPress" });
		// The item is pressed directly, as its key equivalent would run it: the File menu never opens.
		expect(fake.performed).toEqual(["Open:AXPress"]);
		expect(fake.delays).toEqual([]);
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
		// Neither "Open" is pressed; the direct press could not pick one, and the walk that opened the
		// File menu closes it again.
		expect(fake.performed).toEqual(["File:AXPress", "AXMenu:AXCancel"]);
	});
});

describe("chooseMenuAction #given several native actions #when selecting one #then documented priority wins", () => {
	it("prefers AXPress, AXPick, AXShowMenu, then AXOpen", () => {
		expect(chooseMenuAction(["AXOpen", "AXShowMenu", "AXPick"])).toBe("AXPick");
		expect(chooseMenuAction(["AXOpen"])).toBe("AXOpen");
		expect(chooseMenuAction([])).toBeUndefined();
	});
});

describe("invokeMenu #given a background app whose menu item is disabled #when the path is invoked #then no menu is left open", () => {
	it("cancels the menu it opened and says the app being in the background is why", async () => {
		const menu = node("AXMenuBar", undefined, [
			node("AXMenuBarItem", "Edit", [node("AXMenu", undefined, [item("Select All", "A", 0, false)])]),
		]);
		const fake = fakeAccessibility(menu, false);

		await expect(invokeMenu(42, ["Edit", "Select All"], fake.accessibility)).rejects.toThrow(
			/"Select All"\) is disabled: the app is in the background/,
		);
		// The disabled item is refused before any menu opens, so the app never enters menu tracking.
		expect(fake.performed).toEqual([]);
	});
});

describe("findMenuKeyEquivalent #given menu items publishing their key equivalents #when a Command chord is looked up", () => {
	const menu = node("AXMenuBar", undefined, [
		node("AXMenuBarItem", "File", [
			node("AXMenu", undefined, [item("Save", "S", 0, false), item("Save As…", "S", 1, false)]),
		]),
		node("AXMenuBarItem", "Edit", [node("AXMenu", undefined, [item("Select All", "A", 0, false)])]),
		node("AXMenuBarItem", "Format", [
			node("AXMenu", undefined, [
				{ ...node("AXMenuItem", "Font", [node("AXMenu", undefined, [item("Bold", "B", 0, true)])]) },
			]),
		]),
	]);

	it("#then it names the item, its path and whether it is enabled, without opening a menu", () => {
		const fake = fakeAccessibility(menu, false);

		expect(findMenuKeyEquivalent(42, "a", ["cmd"], fake.accessibility)).toEqual({
			path: ["Edit", "Select All"],
			enabled: false,
		});
		expect(findMenuKeyEquivalent(42, "b", ["command"], fake.accessibility)).toEqual({
			path: ["Format", "Font", "Bold"],
			enabled: true,
		});
		expect(fake.performed).toEqual([]);
	});

	it("#then the modifiers must match exactly, so Cmd+S and Shift+Cmd+S are different items", () => {
		const fake = fakeAccessibility(menu, false);

		expect(findMenuKeyEquivalent(42, "s", ["cmd"], fake.accessibility)?.path).toEqual(["File", "Save"]);
		expect(findMenuKeyEquivalent(42, "s", ["shift", "cmd"], fake.accessibility)?.path).toEqual(["File", "Save As…"]);
		expect(findMenuKeyEquivalent(42, "s", ["option", "cmd"], fake.accessibility)).toBeUndefined();
		expect(findMenuKeyEquivalent(42, "a", ["shift"], fake.accessibility)).toBeUndefined();
	});
});

describe("planBackgroundKeyEquivalent #given a Command chord for an app in the background", () => {
	const disabled = (path: string[]) => ({ path, enabled: false });

	it("#when the app is the active one #then real keys are sent as usual", () => {
		expect(
			planBackgroundKeyEquivalent({
				frontmost: true,
				key: "s",
				modifiers: ["cmd"],
				item: disabled(["File", "Save"]),
			}),
		).toEqual({ kind: "keys" });
	});

	it("#when the chord matches an enabled item #then that item is pressed through accessibility", () => {
		expect(
			planBackgroundKeyEquivalent({
				frontmost: false,
				key: "b",
				modifiers: ["cmd"],
				item: { path: ["Format", "Font", "Bold"], enabled: true },
			}),
		).toEqual({ kind: "menu", path: ["Format", "Font", "Bold"] });
	});

	it("#when Select All, Copy or Paste is disabled #then the field itself is used through accessibility", () => {
		const plan = (key: string) =>
			planBackgroundKeyEquivalent({ frontmost: false, key, modifiers: ["cmd"], item: disabled(["Edit", key]) }).kind;
		expect([plan("a"), plan("c"), plan("v")]).toEqual(["select-all", "copy-selection", "paste-text"]);
	});

	it("#when any other window command is disabled #then it is refused instead of reported as done", () => {
		const plan = planBackgroundKeyEquivalent({
			frontmost: false,
			key: "s",
			modifiers: ["cmd"],
			item: disabled(["File", "Save"]),
		});
		expect(plan.kind).toBe("refuse");
		expect(plan.kind === "refuse" ? plan.message : "").toContain("File > Save is disabled");
	});

	it("#when no menu item owns the chord #then real keys are sent", () => {
		expect(planBackgroundKeyEquivalent({ frontmost: false, key: "k", modifiers: ["cmd"], item: undefined })).toEqual({
			kind: "keys",
		});
	});

	it("#when background Undo has no matching menu command #then it refuses rather than posting an unverified chord", () => {
		const plan = planBackgroundKeyEquivalent({
			frontmost: false,
			key: "z",
			modifiers: ["cmd"],
			item: undefined,
		});

		expect(plan.kind).toBe("refuse");
	});

	it("#when Undo has an enabled menu command #then the real app command remains available", () => {
		expect(
			planBackgroundKeyEquivalent({
				frontmost: false,
				key: "z",
				modifiers: ["cmd"],
				item: { path: ["Edit", "Undo Typing"], enabled: true },
			}),
		).toEqual({ kind: "menu", path: ["Edit", "Undo Typing"] });
	});
});

describe("invokeWindowMenu #given a window command for an app behind the person's", () => {
	/** File > Save (Cmd+S), whose state the test changes the way an app does once told it is active. */
	function saveMenu(
		enabled: boolean,
		title = "Save",
	): { readonly save: { enabled: boolean; title: string } & MenuNode; readonly menu: MenuNode } {
		const save = {
			role: "AXMenuItem",
			title,
			enabled,
			actions: ["AXPress"],
			children: [],
			cmdChar: "S",
			cmdModifiers: 0,
		};
		return {
			save,
			menu: node("AXMenuBar", undefined, [node("AXMenuBarItem", "File", [node("AXMenu", undefined, [save])])]),
		};
	}

	/**
	 * Stands in for MacOSInputController.withWindowCommand: an app `behind` the person's is told it is active
	 * when the command wants that; the person's own frontmost app is told nothing.
	 */
	function runner(
		onActivate: () => void = () => undefined,
		behind = true,
	): {
		readonly run: WindowMenuRunner;
		readonly asked: boolean[];
	} {
		const asked: boolean[] = [];
		return {
			asked,
			run: async (wantsActivation, command) => {
				const wanted = wantsActivation();
				asked.push(wanted);
				const activate = wanted && behind;
				if (activate) {
					onActivate();
				}
				return await command(activate);
			},
		};
	}

	it("#when the item is disabled only because the app is in the background #then the app is told it is active and the item is pressed", async () => {
		const { save, menu } = saveMenu(false);
		const fake = fakeAccessibility(menu, false);
		const { run, asked } = runner(() => {
			save.enabled = true;
		});

		const result = await invokeWindowMenu(42, ["File", "Save"], run, fake.accessibility);

		expect(asked).toEqual([true]);
		expect(result).toEqual({ resolvedPath: ["File", "Save"], action: "AXPress" });
		expect(fake.performed).toEqual(["Save:AXPress"]);
	});

	it("#when the app enables the item a little after it is told it is active #then the press waits for it", async () => {
		const { save, menu } = saveMenu(false);
		const fake = fakeAccessibility(menu, false);
		let waits = 0;
		const accessibility: MenuAccessibility = {
			...fake.accessibility,
			delay: async () => {
				waits += 1;
				if (waits === 3) {
					save.enabled = true;
				}
			},
		};

		await invokeWindowMenu(42, ["File", "Save"], runner().run, accessibility);

		expect(waits).toBe(3);
		expect(fake.performed).toEqual(["Save:AXPress"]);
	});

	it("#when the item stays disabled even with the app told it is active #then it is refused after a bounded wait and nothing is pressed", async () => {
		const { menu } = saveMenu(false);
		const fake = fakeAccessibility(menu, false);

		await expect(invokeWindowMenu(42, ["File", "Save"], runner().run, fake.accessibility)).rejects.toThrow(
			/"Save"\) is disabled/,
		);

		expect(fake.performed).toEqual([]);
		expect(fake.delays.length).toBeGreaterThan(0);
		expect(fake.delays.reduce((total, milliseconds) => total + milliseconds, 0)).toBeLessThanOrEqual(2_000);
	});

	it("#when the item reads enabled in the background #then the app is still told it is active first, since that flag is only what it last validated", async () => {
		const { menu } = saveMenu(true);
		const fake = fakeAccessibility(menu, false);
		const { run, asked } = runner();

		await invokeWindowMenu(42, ["File", "Save"], run, fake.accessibility);

		expect(asked).toEqual([true]);
		expect(fake.performed).toEqual(["Save:AXPress"]);
		expect(fake.delays).toEqual([]);
	});

	it("#when the app is the person's frontmost one and the item is disabled #then it is refused at once, with no wait", async () => {
		const { menu } = saveMenu(false);
		const fake = fakeAccessibility(menu, true);
		const { run } = runner(() => undefined, false);

		await expect(invokeWindowMenu(42, ["File", "Save"], run, fake.accessibility)).rejects.toThrow(
			/"Save"\) is disabled; failed at hop 1/,
		);

		expect(fake.performed).toEqual([]);
		expect(fake.delays).toEqual([]);
	});

	it("#when telling the app it is active retitles the item (Save… becomes Save) #then it is found and pressed under its new title", async () => {
		const { save, menu } = saveMenu(false, "Save…");
		const fake = fakeAccessibility(menu, false);
		const { run } = runner(() => {
			save.title = "Save";
			save.enabled = true;
		});

		const result = await invokeWindowMenu(42, ["File", "Save"], run, fake.accessibility);

		expect(result.resolvedPath).toEqual(["File", "Save"]);
		expect(fake.performed).toEqual(["Save:AXPress"]);
	});

	it("#when the app has no such menu #then no activation is asked for and the path is refused", async () => {
		const { menu } = saveMenu(true);
		const fake = fakeAccessibility(menu, false);
		const { run, asked } = runner();

		await expect(invokeWindowMenu(42, ["Window", "Zoom"], run, fake.accessibility)).rejects.toThrow(
			/"Window"\) was not found/,
		);

		expect(asked).toEqual([false]);
	});

	it("#when a chord's item turns enabled and retitled a moment after activation #then the wait finds it by its key", async () => {
		const { save, menu } = saveMenu(false, "Save…");
		const fake = fakeAccessibility(menu, false);
		let waits = 0;
		const accessibility: MenuAccessibility = {
			...fake.accessibility,
			delay: async () => {
				waits += 1;
				if (waits === 2) {
					save.title = "Save";
					save.enabled = true;
				}
			},
		};

		const item = await waitForKeyEquivalentEnabled(42, "s", ["cmd"], accessibility);

		expect(item).toEqual({ path: ["File", "Save"], enabled: true });
		expect(waits).toBe(2);
	});
});

describe("invokeMenu #given a leaf that only opens (no press action) #when the path is invoked #then the menus are walked hop by hop", () => {
	it("falls back to opening each hop when the item cannot be pressed directly", async () => {
		const open: MenuNode = { role: "AXMenuItem", title: "Recent", enabled: true, actions: ["AXOpen"], children: [] };
		const menu = node("AXMenuBar", undefined, [node("AXMenuBarItem", "File", [node("AXMenu", undefined, [open])])]);
		const fake = fakeAccessibility(menu);

		const result = await invokeMenu(42, ["File", "Recent"], fake.accessibility);

		expect(result.action).toBe("AXOpen");
		expect(fake.performed).toEqual(["File:AXPress", "Recent:AXOpen"]);
	});
});

function node(role: string, title: string | undefined, children: readonly MenuNode[]): MenuNode {
	return { role, ...(title === undefined ? {} : { title }), enabled: true, actions: ["AXPress"], children };
}

function item(title: string, cmdChar: string, cmdModifiers: number, enabled: boolean): MenuNode {
	return { role: "AXMenuItem", title, enabled, actions: ["AXPress"], children: [], cmdChar, cmdModifiers };
}

function fakeAccessibility(
	menuBar: MenuNode,
	frontmost = true,
): {
	readonly accessibility: MenuAccessibility;
	readonly performed: string[];
	readonly delays: number[];
} {
	const application: MenuNode = { role: "AXApplication", frontmost };
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
				if (attribute === "AXMenuItemCmdChar") {
					return item.cmdChar ?? null;
				}
				return attribute === "AXRole" ? item.role : attribute === "AXTitle" ? (item.title ?? null) : null;
			},
			booleanAttribute: (element, attribute) => {
				const item = element as MenuNode;
				if (attribute === "AXFrontmost") {
					return item.frontmost ?? null;
				}
				return attribute === "AXEnabled" ? (item.enabled ?? null) : null;
			},
			numberAttribute: (element, attribute) =>
				attribute === "AXMenuItemCmdModifiers" ? ((element as MenuNode).cmdModifiers ?? null) : null,
			actionNames: (element) => [...((element as MenuNode).actions ?? [])],
			perform: (element, action) =>
				performed.push(`${(element as MenuNode).title ?? (element as MenuNode).role}:${action}`),
			release: () => undefined,
			delay: async (milliseconds) => {
				delays.push(milliseconds);
			},
		},
	};
}
