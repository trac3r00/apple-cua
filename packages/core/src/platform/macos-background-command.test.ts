import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	bundleId: "com.apple.finder",
	frontmost: false,
	itemVisible: true,
	path: ["Go", "Go to Folder…"],
}));
const menu = vi.hoisted(() => ({
	pressMenuItem: vi.fn(),
	invokeMenu: vi.fn(async (_pid: number, path: readonly string[]) => ({ resolvedPath: path, action: "AXPress" })),
}));

vi.mock("./app-list.js", () => ({
	getRunningMacOSApps: async () => [
		{
			pid: 4242,
			name: "Finder",
			bundleId: state.bundleId,
			isActive: state.frontmost,
			path: "/Applications/Finder.app",
		},
	],
}));
vi.mock("./macos-menu.js", async () => {
	const actual = await vi.importActual<typeof import("./macos-menu.js")>("./macos-menu.js");
	return {
		...actual,
		applicationIsFrontmost: () => state.frontmost,
		findMenuKeyEquivalent: () => (state.itemVisible ? { path: state.path, enabled: true } : undefined),
		pressMenuItem: menu.pressMenuItem,
		invokeMenu: menu.invokeMenu,
	};
});
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));

import { runInInputScope } from "../computer/input-scope.js";
import { NOOP_POINTER_OVERLAY } from "./macos-ffi/cursor-overlay.js";
import { MacOSInputController } from "./macos-input.js";
import { MacOSHostComputer } from "./macos.js";

describe("#given Finder commands that activate their app", () => {
	let computer: MacOSHostComputer;
	beforeEach(() => {
		vi.clearAllMocks();
		state.bundleId = "com.apple.finder";
		state.frontmost = false;
		state.itemVisible = true;
		state.path = ["Go", "Go to Folder…"];
		vi.spyOn(MacOSInputController.prototype, "prepareKeyboardTarget").mockResolvedValue(undefined);
		vi.spyOn(MacOSInputController.prototype, "pressKey").mockResolvedValue(undefined);
		computer = new MacOSHostComputer({ delivery: "background", overlay: NOOP_POINTER_OVERLAY });
	});
	afterEach(async () => {
		await computer.close();
		vi.restoreAllMocks();
	});

	const goToFolder = () =>
		runInInputScope({ target: { pid: 4242 } }, () => computer.key("g", { modifiers: ["shift", "cmd"] }));

	it("#when Go to Folder is requested in the background #then refuses before preparing or dispatching input", async () => {
		await expect(goToFolder()).rejects.toThrow();
		expect(MacOSInputController.prototype.prepareKeyboardTarget).not.toHaveBeenCalled();
		expect(MacOSInputController.prototype.pressKey).not.toHaveBeenCalled();
		expect(menu.pressMenuItem).not.toHaveBeenCalled();
	});

	it("#when the menu is unreadable #then the chord still refuses rather than falling back to posted keys", async () => {
		state.itemVisible = false;
		await expect(goToFolder()).rejects.toThrow();
		expect(MacOSInputController.prototype.pressKey).not.toHaveBeenCalled();
	});

	it("#when the explicit menu path is requested #then refuses before invoking the native menu", async () => {
		await expect(computer.invokeMenu(4242, ["Go", "Go to Folder…"])).rejects.toThrow();
		expect(menu.invokeMenu).not.toHaveBeenCalled();
	});

	it("#when the driver holds Finder active behind the person #then its AXFrontmost flag does not permit the command", async () => {
		state.frontmost = true;
		vi.spyOn(MacOSInputController.prototype, "holdsActivation").mockReturnValue(true);
		await expect(goToFolder()).rejects.toThrow();
		expect(MacOSInputController.prototype.prepareKeyboardTarget).not.toHaveBeenCalled();
	});

	it("#when a localized menu matches the Go to Folder key equivalent #then refuses its explicit path", async () => {
		state.path = ["Gehe zu", "Gehe zum Ordner…"];
		await expect(computer.invokeMenu(4242, state.path)).rejects.toThrow();
		expect(menu.invokeMenu).not.toHaveBeenCalled();
	});

	it("#when the explicit ASCII-ellipsis path has no readable menu #then refuses without falling back", async () => {
		state.itemVisible = false;
		await expect(computer.invokeMenu(4242, ["Go", "Go to Folder..."])).rejects.toThrow();
		expect(menu.invokeMenu).not.toHaveBeenCalled();
	});

	it("#when another Finder menu command is requested #then preserves its native menu route", async () => {
		await computer.invokeMenu(4242, ["File", "New Folder"]);
		expect(menu.invokeMenu).toHaveBeenCalledWith(4242, ["File", "New Folder"]);
	});

	it("#when Finder is already the person's front app #then keeps the existing key route", async () => {
		state.frontmost = true;
		await goToFolder();
		expect(MacOSInputController.prototype.pressKey).toHaveBeenCalledWith("g", { modifiers: ["shift", "cmd"] });
	});

	it("#when another app uses the same chord #then keeps its existing menu route", async () => {
		state.bundleId = "com.example.editor";
		await goToFolder();
		expect(menu.pressMenuItem).toHaveBeenCalledWith(4242, ["Go", "Go to Folder…"]);
	});
});
