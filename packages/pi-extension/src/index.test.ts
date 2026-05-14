import { beforeEach, describe, expect, it, vi } from "vitest";

const macOSHostComputerMock = vi.hoisted(() => {
	const instance = {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn(),
		move: vi.fn(),
		click: vi.fn(),
		rightClick: vi.fn(),
		middleClick: vi.fn(),
		doubleClick: vi.fn(),
		type: vi.fn(),
		key: vi.fn(),
		scroll: vi.fn(),
		drag: vi.fn(),
		getCursorPosition: vi.fn(),
		getScreenSize: vi.fn().mockResolvedValue({ width: 2560, height: 1600 }),
		close: vi.fn().mockResolvedValue(undefined),
	};
	return {
		constructor: vi.fn(() => instance),
		instance,
	};
});

vi.mock("@macos-cua/core", () => ({
	MacOSHostComputer: macOSHostComputerMock.constructor,
}));

import macosCuaExtension from "./index.js";
import type { ExtensionAPI } from "./pi/index.js";

type EventHandler = (...parameters: ReadonlyArray<never>) => unknown;

interface MockPi extends ExtensionAPI {
	readonly handlers: Map<string, EventHandler>;
	readonly registeredTools: Array<{ readonly name: string }>;
}

function createMockPi(): MockPi {
	const handlers = new Map<string, EventHandler>();
	const registeredTools: Array<{ readonly name: string }> = [];
	const on = ((eventName: string, handler: EventHandler) => {
		handlers.set(eventName, handler as EventHandler);
	}) as ExtensionAPI["on"];
	return {
		handlers,
		registeredTools,
		on,
		registerTool(tool) {
			registeredTools.push({ name: tool.name });
		},
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

beforeEach(() => {
	process.env["MACOS_CUA_DISABLE_COMPUTER_USE_BETA"] = undefined;
	vi.clearAllMocks();
	macOSHostComputerMock.instance.getScreenSize.mockResolvedValue({ width: 2560, height: 1600 });
	macOSHostComputerMock.instance.close.mockResolvedValue(undefined);
});

async function runSessionStart(pi: MockPi): Promise<void> {
	const sessionStart = pi.handlers.get("session_start");
	if (sessionStart === undefined) {
		throw new Error("session_start handler missing");
	}
	await sessionStart();
}

describe("#given macosCuaExtension #when imported #then default export is a named function", () => {
	it("is a function named macosCuaExtension", () => {
		expect(typeof macosCuaExtension).toBe("function");
		expect(macosCuaExtension.name).toBe("macosCuaExtension");
	});
});

describe("#given a pi API #when extension factory runs #then lifecycle handlers are registered", () => {
	it("registers resources_discover, session_start, request, prompt, and session_shutdown handlers", () => {
		const pi = createMockPi();
		const onSpy = vi.spyOn(pi, "on");

		macosCuaExtension(pi);

		expect(onSpy).toHaveBeenCalledWith("resources_discover", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("before_provider_request", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
		expect(onSpy).toHaveBeenCalledTimes(5);
		expect([...pi.handlers.keys()]).toEqual([
			"resources_discover",
			"session_start",
			"before_provider_request",
			"before_agent_start",
			"session_shutdown",
		]);
	});
});

describe("#given default-on session_start #when invoked #then native computer and macos_cua tools are registered", () => {
	it("registers computer alongside the nine prefixed tools", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi);

		expect(pi.registeredTools.map((tool) => tool.name)).toEqual([
			"macos_cua_screenshot",
			"macos_cua_click",
			"macos_cua_type",
			"macos_cua_key",
			"macos_cua_scroll",
			"macos_cua_double_click",
			"macos_cua_drag",
			"macos_cua_cursor_position",
			"macos_cua_screen_size",
			"computer",
		]);
	});
});

describe("#given opt-out env var #when session_start runs #then native computer tool is not registered", () => {
	it("keeps only the nine prefixed tools", async () => {
		process.env["MACOS_CUA_DISABLE_COMPUTER_USE_BETA"] = "1";
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi);

		expect(pi.registeredTools.map((tool) => tool.name)).toEqual([
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

describe("#given resources_discover #when invoked #then macOS skill path is returned", () => {
	it("returns the macos-cua skill path", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		const resourcesDiscover = pi.handlers.get("resources_discover");

		expect(resourcesDiscover).toBeDefined();
		const result = await resourcesDiscover?.();

		expect(result).toEqual({
			skillPaths: [expect.stringContaining("skills/macos-cua/SKILL.md")],
		});
	});
});
