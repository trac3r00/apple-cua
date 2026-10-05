import { beforeEach, describe, expect, it, vi } from "vitest";

const selectText = vi.hoisted(() => ({
	selectAllInFocusedTextElement: vi.fn<(pid: number) => boolean>(() => true),
	selectedTextOfFocusedElement: vi.fn<(pid: number) => string | undefined>(() => "chosen words"),
	replaceSelectionInFocusedTextElement: vi.fn<(pid: number, text: string) => boolean>(() => true),
	selectTextByIndex: vi.fn(),
}));
const pasteboard = vi.hoisted(() => ({
	writeClipboard: vi.fn(),
	readClipboard: vi.fn(() => ({ types: ["public.utf8-plain-text"], text: "from clipboard", fileUrls: [] })),
}));
const menu = vi.hoisted(() => ({
	invokeMenu: vi.fn(async (_pid: number, path: readonly string[]) => ({ resolvedPath: path, action: "AXPress" })),
	normalizeMenuPath: (path: readonly string[]) => path.map((segment) => segment.trim()),
	commandChordMask: () => undefined,
	findMenuKeyEquivalent: () => undefined,
	applicationIsFrontmost: () => true,
	planBackgroundKeyEquivalent: () => ({ kind: "keys" }),
	pressMenuItem: vi.fn(),
}));
const accessibility = vi.hoisted(() => ({
	extractAccessibilityTree: vi.fn(),
	focusedWindowIdForPid: vi.fn(() => undefined),
	focusedWindowIsModal: vi.fn(() => false),
	focusedElementFrame: vi.fn(() => undefined),
	typeIntoFocusedAXElement: vi.fn(() => true),
	performActionByIndex: vi.fn(),
	setValueByIndex: vi.fn(),
	releaseAccessibilitySnapshot: vi.fn(),
}));

vi.mock("./macos-ffi/select-text.js", () => selectText);
vi.mock("./macos-ffi/pasteboard.js", () => pasteboard);
vi.mock("./macos-menu.js", () => menu);
vi.mock("./macos-ffi/accessibility.js", () => accessibility);
vi.mock("./macos-ffi/ax-observer.js", () => ({
	createAxEventWaiter: () => null,
	waitForAxQuiet: () => ({ quiet: true, events: 0, elapsedMs: 0 }),
}));
vi.mock("./keyboard-fence.js", () => ({
	awaitKeyboardFence: async () => ({ waited: false, events: 0, elapsedMs: 0 }),
	awaitAccessibilityWriteSettled: async () => ({ waited: false, events: 0, elapsedMs: 0 }),
}));
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));

import { MacOSHostComputer } from "./macos.js";

const PID = 4242;

describe("#given Edit menu commands that AppKit validates only while its menu is shown", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectText.selectedTextOfFocusedElement.mockReturnValue("chosen words");
	});

	it("#when Edit > Copy is invoked #then the focused field's selection goes to the clipboard without opening the menu", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		const result = await computer.invokeMenu(PID, ["Edit", "Copy"]);

		expect(result).toEqual({ resolvedPath: ["Edit", "Copy"], action: "accessibility" });
		expect(pasteboard.writeClipboard).toHaveBeenCalledWith({ type: "text", text: "chosen words" });
		expect(menu.invokeMenu).not.toHaveBeenCalled();
		await computer.close();
	});

	it("#when Edit > Cut is invoked #then the selection is copied and then removed from the field", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		await computer.invokeMenu(PID, ["Edit", "Cut"]);

		expect(pasteboard.writeClipboard).toHaveBeenCalledWith({ type: "text", text: "chosen words" });
		expect(selectText.replaceSelectionInFocusedTextElement).toHaveBeenCalledWith(PID, "");
		await computer.close();
	});

	it("#when Edit > Select All and Paste are invoked #then the field itself is selected and typed into", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		await computer.invokeMenu(PID, ["Edit", "Select All"]);
		await computer.invokeMenu(PID, ["Edit", "Paste"]);

		expect(selectText.selectAllInFocusedTextElement).toHaveBeenCalledWith(PID);
		expect(accessibility.typeIntoFocusedAXElement).toHaveBeenCalledWith(PID, "from clipboard");
		expect(menu.invokeMenu).not.toHaveBeenCalled();
		await computer.close();
	});

	it("#when nothing is selected in a native field #then Copy is handed to the menu, which decides", async () => {
		selectText.selectedTextOfFocusedElement.mockReturnValue(undefined);
		const computer = new MacOSHostComputer({ delivery: "background" });

		await computer.invokeMenu(PID, ["Edit", "Copy"]);

		expect(pasteboard.writeClipboard).not.toHaveBeenCalled();
		expect(menu.invokeMenu).toHaveBeenCalledWith(PID, ["Edit", "Copy"]);
		await computer.close();
	});

	it("#when any other path is invoked #then it is pressed as a menu item", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		const result = await computer.invokeMenu(PID, ["Format", "Font", "Bold"]);

		expect(result.action).toBe("AXPress");
		expect(menu.invokeMenu).toHaveBeenCalledWith(PID, ["Format", "Font", "Bold"]);
		await computer.close();
	});
});
