import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";
import type { MenuKeyEquivalent } from "./macos-menu.js";

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
	commandChordMask: vi.fn<() => number | undefined>(() => undefined),
	findMenuKeyEquivalent: vi.fn<() => MenuKeyEquivalent | undefined>(() => undefined),
	applicationIsFrontmost: () => true,
	planBackgroundKeyEquivalent: () => ({ kind: "keys" }),
	pressMenuItem: vi.fn(),
}));
const accessibility = vi.hoisted(() => ({
	extractAccessibilityTree: vi.fn(),
	focusedWindowIdForPid: vi.fn(() => undefined),
	focusedWindowIsModal: vi.fn(() => false),
	focusedWindowShowsFilePanel: vi.fn(() => false),
	focusedElementFrame: vi.fn(() => undefined),
	typeIntoFocusedAXElement: vi.fn(() => true),
	performActionByIndex: vi.fn(),
	setValueByIndex: vi.fn(),
	releaseAccessibilitySnapshot: vi.fn(),
}));
const keyboardFence = vi.hoisted(() => ({
	awaitKeyboardFence: vi.fn(async (_lastInput: number | undefined) => ({ waited: false, events: 0, elapsedMs: 0 })),
	awaitAccessibilityWriteSettled: async () => ({ waited: false, events: 0, elapsedMs: 0 }),
}));

vi.mock("./macos-ffi/select-text.js", () => selectText);
vi.mock("./macos-ffi/pasteboard.js", () => pasteboard);
vi.mock("./macos-menu.js", () => menu);
vi.mock("./macos-ffi/accessibility.js", () => accessibility);
vi.mock("./macos-ffi/ax-observer.js", () => ({
	createAxEventWaiter: () => null,
	waitForAxQuiet: () => ({ quiet: true, events: 0, elapsedMs: 0 }),
}));
vi.mock("./keyboard-fence.js", () => keyboardFence);
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));

const { MacOSInputController } = await import("./macos-input.js");
const { MacOSHostComputer } = await import("./macos.js");

const PID = 4242;

afterEach(() => {
	vi.restoreAllMocks();
	menu.commandChordMask.mockReturnValue(undefined);
	menu.findMenuKeyEquivalent.mockReturnValue(undefined);
	accessibility.focusedWindowShowsFilePanel.mockReturnValue(false);
});

const HOST_REFUSAL = /host-window cannot operate on the human desktop/;

describe("#given a background Save panel #when its shortcut overlaps the app menu #then the human desktop refuses it", () => {
	it("refuses Go to Folder before keyboard delivery or a menu lookup", async () => {
		menu.commandChordMask.mockReturnValue(1);
		menu.findMenuKeyEquivalent.mockReturnValue({ path: ["Edit", "Find", "Find Previous"], enabled: false });
		accessibility.focusedWindowShowsFilePanel.mockReturnValue(true);
		const prepare = vi.spyOn(MacOSInputController.prototype, "prepareKeyboardTarget").mockResolvedValue();
		const press = vi.spyOn(MacOSInputController.prototype, "pressKey").mockResolvedValue();
		const computer = new MacOSHostComputer({ defaultTargetPid: PID, delivery: "background" });

		await expect(computer.key("g", { modifiers: ["command", "shift"] })).rejects.toThrow(HOST_REFUSAL);

		expect(prepare).not.toHaveBeenCalled();
		expect(menu.findMenuKeyEquivalent).not.toHaveBeenCalled();
		expect(press).not.toHaveBeenCalled();
		await computer.close();
	});
});

describe("#given Edit menu commands on the human desktop #when invoked #then each is refused before any clipboard, field or menu effect", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectText.selectedTextOfFocusedElement.mockReturnValue("chosen words");
	});

	it("#when a menu command precedes focused typing #then neither runs, so no keyboard readiness fence is armed", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });
		try {
			await expect(computer.invokeMenu(PID, ["File", "New Folder"])).rejects.toThrow(HOST_REFUSAL);
			await expect(computer.typeIntoFocused(PID, "bench-folder")).rejects.toThrow(HOST_REFUSAL);

			expect(keyboardFence.awaitKeyboardFence).not.toHaveBeenCalled();
			expect(accessibility.typeIntoFocusedAXElement).not.toHaveBeenCalled();
		} finally {
			await computer.close();
		}
	});

	it("#when Edit > Copy is invoked #then the selection never reaches the clipboard", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		await expect(computer.invokeMenu(PID, ["Edit", "Copy"])).rejects.toThrow(HOST_REFUSAL);

		expect(pasteboard.writeClipboard).not.toHaveBeenCalled();
		expect(menu.invokeMenu).not.toHaveBeenCalled();
		await computer.close();
	});

	it("#when Edit > Cut is invoked #then nothing is copied or removed from the field", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		await expect(computer.invokeMenu(PID, ["Edit", "Cut"])).rejects.toThrow(HOST_REFUSAL);

		expect(pasteboard.writeClipboard).not.toHaveBeenCalled();
		expect(selectText.replaceSelectionInFocusedTextElement).not.toHaveBeenCalled();
		await computer.close();
	});

	it("#when Edit > Select All and Paste are invoked #then the field is neither selected nor typed into", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		await expect(computer.invokeMenu(PID, ["Edit", "Select All"])).rejects.toThrow(HOST_REFUSAL);
		await expect(computer.invokeMenu(PID, ["Edit", "Paste"])).rejects.toThrow(HOST_REFUSAL);

		expect(selectText.selectAllInFocusedTextElement).not.toHaveBeenCalled();
		expect(pasteboard.readClipboard).not.toHaveBeenCalled();
		expect(accessibility.typeIntoFocusedAXElement).not.toHaveBeenCalled();
		expect(menu.invokeMenu).not.toHaveBeenCalled();
		await computer.close();
	});

	it("#when nothing is selected in a native field #then Copy is not handed to the menu either", async () => {
		selectText.selectedTextOfFocusedElement.mockReturnValue(undefined);
		const computer = new MacOSHostComputer({ delivery: "background" });

		await expect(computer.invokeMenu(PID, ["Edit", "Copy"])).rejects.toThrow(HOST_REFUSAL);

		expect(pasteboard.writeClipboard).not.toHaveBeenCalled();
		expect(menu.invokeMenu).not.toHaveBeenCalled();
		await computer.close();
	});

	it("#when any other path is invoked #then it is not pressed as a menu item", async () => {
		const computer = new MacOSHostComputer({ delivery: "background" });

		await expect(computer.invokeMenu(PID, ["Format", "Font", "Bold"])).rejects.toThrow(HOST_REFUSAL);

		expect(menu.invokeMenu).not.toHaveBeenCalled();
		await computer.close();
	});
});
