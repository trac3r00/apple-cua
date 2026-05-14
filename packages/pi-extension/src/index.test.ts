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
		getScreenSize: vi.fn().mockResolvedValue({ width: 2560, height: 1440 }),
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

type EventHandler = (...parameters: ReadonlyArray<unknown>) => unknown;

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
	macOSHostComputerMock.instance.getScreenSize.mockResolvedValue({ width: 2560, height: 1440 });
	macOSHostComputerMock.instance.close.mockResolvedValue(undefined);
});

async function runSessionStart(pi: MockPi): Promise<void> {
	const sessionStart = pi.handlers.get("session_start");
	if (sessionStart === undefined) {
		throw new Error("session_start handler missing");
	}
	await sessionStart();
}

function runBeforeProviderRequest(pi: MockPi, api: string, payload: unknown): unknown {
	const beforeProviderRequest = pi.handlers.get("before_provider_request");
	if (beforeProviderRequest === undefined) {
		throw new Error("before_provider_request handler missing");
	}
	return beforeProviderRequest({ payload }, { model: { api } });
}

async function runBeforeAgentStart(pi: MockPi, api: string): Promise<unknown> {
	const beforeAgentStart = pi.handlers.get("before_agent_start");
	if (beforeAgentStart === undefined) {
		throw new Error("before_agent_start handler missing");
	}
	return beforeAgentStart({ systemPrompt: "base prompt" }, { model: { api } });
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

describe("#given enabled session and non-computer provider #when provider payload hook runs #then payload passes through", () => {
	it("returns the original payload for other APIs", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);
		const payload = { tools: [] };

		const result = runBeforeProviderRequest(pi, "google-generative-ai", payload);

		expect(result).toBe(payload);
	});
});

describe("#given enabled session and OpenAI Responses #when provider payload hook runs #then native computer tool is added", () => {
	it("appends the OpenAI computer tool", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);
		const shellTool = { type: "function", name: "shell" };

		const result = runBeforeProviderRequest(pi, "openai-responses", { tools: [shellTool] });

		expect(result).toEqual({ tools: [shellTool, { type: "computer" }] });
	});
});

describe("#given enabled session and Anthropic Messages #when provider payload hook runs #then downscaled native computer tool is added", () => {
	it("injects Anthropic computer use with 1280x720 display dimensions", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);

		const result = runBeforeProviderRequest(pi, "anthropic-messages", { messages: [] });

		expect(result).toMatchObject({
			tools: [
				{
					type: "computer_20250124",
					name: "computer",
					display_width_px: 1280,
					display_height_px: 720,
				},
			],
			headers: { "anthropic-beta": "computer-use-2025-01-24" },
			extra_body: { betas: ["computer-use-2025-01-24"] },
		});
	});
});

describe("#given enabled session #when agent prompt hook runs #then native computer scaffolds match provider", () => {
	it("adds Anthropic computer prompt with downscaled dimensions", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);

		const result = await runBeforeAgentStart(pi, "anthropic-messages");

		expect(result).toEqual({
			systemPrompt: expect.stringContaining("Native `computer` tool available (1280x720)"),
		});
	});

	it("adds OpenAI computer prompt with downscaled dimensions", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);

		const result = await runBeforeAgentStart(pi, "openai-responses");

		expect(result).toEqual({
			systemPrompt: expect.stringContaining("screenshots are 1280x720"),
		});
	});
});
