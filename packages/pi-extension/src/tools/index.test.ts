import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "../pi/index.js";
import { buildAllTools, registerAllTools } from "./index.js";

function createPiApi(): ExtensionAPI {
	const on = ((eventName: string, handler: (...parameters: ReadonlyArray<unknown>) => unknown) => {
		void eventName;
		void handler;
	}) as ExtensionAPI["on"];
	return {
		on,
		registerTool() {},
		registerCommand() {},
		registerShortcut() {},
		registerFlag() {},
		getFlag() {
			return undefined;
		},
		registerMessageRenderer() {},
		sendMessage() {},
		sendUserMessage() {},
		appendEntry() {},
		setSessionName() {},
		getSessionName() {
			return undefined;
		},
		setLabel() {},
		exec: vi.fn<ExtensionAPI["exec"]>(),
		getActiveTools() {
			return [];
		},
		getAllTools() {
			return [];
		},
		setActiveTools() {},
		getCommands() {
			return [];
		},
		setModel: vi.fn<ExtensionAPI["setModel"]>().mockResolvedValue(false),
		getThinkingLevel: vi.fn<ExtensionAPI["getThinkingLevel"]>(),
		setThinkingLevel() {},
		registerProvider() {},
		unregisterProvider() {},
		events: {} as ExtensionAPI["events"],
	};
}

function createComputer(): MacOSHostComputer {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn(),
		click: vi.fn(),
		doubleClick: vi.fn(),
		type: vi.fn(),
		key: vi.fn(),
		scroll: vi.fn(),
		drag: vi.fn(),
		getCursorPosition: vi.fn(),
		getScreenSize: vi.fn(),
		close: vi.fn(),
	};
}

describe("#given all tool factories #when built #then every macOS CUA tool is present", () => {
	it("builds the expected tool names", () => {
		const tools = buildAllTools({ computer: createComputer() });

		expect(tools.map((tool) => tool.name)).toEqual([
			"macos_cua_screenshot",
			"macos_cua_click",
			"macos_cua_type",
			"macos_cua_key",
			"macos_cua_scroll",
			"macos_cua_double_click",
			"macos_cua_drag",
			"macos_cua_cursor_position",
			"macos_cua_screen_size",
		]);
	});
});

describe("#given all tools #when registered #then pi.registerTool is called for each tool", () => {
	it("registers every built tool", () => {
		const pi = createPiApi();
		const registerToolSpy = vi.spyOn(pi, "registerTool");

		registerAllTools(pi, { computer: createComputer() });

		expect(registerToolSpy).toHaveBeenCalledTimes(9);
	});
});
