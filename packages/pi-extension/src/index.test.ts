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
		setTarget: vi.fn(),
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
		getAppState: vi.fn().mockResolvedValue({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [],
			screenshotBase64: "",
			screenshotWidth: 1280,
			screenshotHeight: 720,
		}),
		listApps: vi
			.fn()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn().mockResolvedValue(undefined),
		performAction: vi.fn().mockResolvedValue(undefined),
		pressAtPosition: vi.fn().mockResolvedValue(false),
		typeIntoFocused: vi.fn().mockResolvedValue(false),
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
	const activeTools: string[] = [];
	const on = ((eventName: string, handler: EventHandler) => {
		handlers.set(eventName, handler as EventHandler);
	}) as ExtensionAPI["on"];
	return {
		handlers,
		registeredTools,
		on,
		registerTool(tool) {
			registeredTools.push({ name: tool.name });
			activeTools.push(tool.name);
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
			return [...activeTools];
		},
		getAllTools() {
			return [];
		},
		setActiveTools(toolNames) {
			activeTools.splice(0, activeTools.length, ...toolNames);
		},
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

async function runSessionStart(pi: MockPi, model?: TestModel): Promise<void> {
	const sessionStart = pi.handlers.get("session_start");
	if (sessionStart === undefined) {
		throw new Error("session_start handler missing");
	}
	await sessionStart({ reason: "startup" }, { model });
}

interface TestModel {
	readonly api: string;
	readonly baseUrl?: string;
	readonly provider?: string;
	readonly id?: string;
}

async function runModelSelect(pi: MockPi, model: TestModel): Promise<void> {
	const modelSelect = pi.handlers.get("model_select");
	if (modelSelect === undefined) {
		throw new Error("model_select handler missing");
	}
	await modelSelect({ model, previousModel: undefined, source: "set" }, { model });
}

function runBeforeProviderRequest(pi: MockPi, model: string | TestModel, payload: unknown): unknown {
	const beforeProviderRequest = pi.handlers.get("before_provider_request");
	if (beforeProviderRequest === undefined) {
		throw new Error("before_provider_request handler missing");
	}
	const resolvedModel = typeof model === "string" ? { api: model } : model;
	return beforeProviderRequest({ payload }, { model: resolvedModel });
}

async function runBeforeAgentStart(pi: MockPi, model: string | TestModel): Promise<unknown> {
	const beforeAgentStart = pi.handlers.get("before_agent_start");
	if (beforeAgentStart === undefined) {
		throw new Error("before_agent_start handler missing");
	}
	const resolvedModel = typeof model === "string" ? { api: model } : model;
	return beforeAgentStart({ systemPrompt: "base prompt" }, { model: resolvedModel });
}

describe("#given macosCuaExtension #when imported #then default export is a named function", () => {
	it("is a function named macosCuaExtension", () => {
		expect(typeof macosCuaExtension).toBe("function");
		expect(macosCuaExtension.name).toBe("macosCuaExtension");
	});
});

describe("#given a pi API #when extension factory runs #then lifecycle handlers are registered", () => {
	it("registers resources_discover, session_start, model_select, request, prompt, and session_shutdown handlers", () => {
		const pi = createMockPi();
		const onSpy = vi.spyOn(pi, "on");

		macosCuaExtension(pi);

		expect(onSpy).toHaveBeenCalledWith("resources_discover", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("model_select", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("before_provider_request", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
		expect(onSpy).toHaveBeenCalledTimes(6);
		expect([...pi.handlers.keys()]).toEqual([
			"resources_discover",
			"session_start",
			"model_select",
			"before_provider_request",
			"before_agent_start",
			"session_shutdown",
		]);
	});
});

describe("#given default-on session_start #when invoked #then native computer and Codex tools are registered", () => {
	it("registers computer alongside the nine Codex-compatible tools", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi);

		expect(pi.registeredTools.map((tool) => tool.name)).toEqual([
			"list_apps",
			"get_app_state",
			"click",
			"perform_secondary_action",
			"set_value",
			"drag",
			"scroll",
			"type_text",
			"press_key",
			"computer",
		]);
	});
});

describe("#given opt-out env var #when session_start runs #then native computer tool is not registered", () => {
	it("keeps only the nine Codex-compatible tools", async () => {
		process.env["MACOS_CUA_DISABLE_COMPUTER_USE_BETA"] = "1";
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi);

		expect(pi.registeredTools.map((tool) => tool.name)).toEqual([
			"list_apps",
			"get_app_state",
			"click",
			"perform_secondary_action",
			"set_value",
			"drag",
			"scroll",
			"type_text",
			"press_key",
		]);
	});
});

describe("#given enabled OpenAI Chat session #when session_start runs #then fallback computer tool is inactive", () => {
	it("keeps computer registered for execution but not active for Chat Completions providers", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi, {
			api: "openai-completions",
			provider: "opengateway-dev",
			baseUrl: "https://dev-asmr-v2.sionic.im/v1",
		});

		expect(pi.registeredTools.map((tool) => tool.name)).toContain("computer");
		expect(pi.getActiveTools()).not.toContain("computer");
	});
});

describe("#given supported Anthropic sonnet session #when session_start runs #then fallback computer tool stays active", () => {
	it("keeps computer active for sonnet native computer-use payloads", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5" });

		expect(pi.getActiveTools()).toContain("computer");
	});
});

describe("#given unsupported Anthropic model session #when session_start runs #then fallback computer tool is inactive", () => {
	it("does not activate computer for models without native computer-use support", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: "claude-opus-4-8" });

		expect(pi.getActiveTools()).not.toContain("computer");
	});

	it("does not activate computer when model id is unknown", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic" });

		expect(pi.getActiveTools()).not.toContain("computer");
	});
});

describe("#given enabled OpenAI proxy Responses session #when session_start runs #then fallback computer tool is inactive", () => {
	it("does not activate computer for OpenAI-compatible Responses proxies", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		await runSessionStart(pi, {
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://quotio.mengmota.com/v1",
		});

		expect(pi.getActiveTools()).not.toContain("computer");
	});
});

describe("#given enabled session #when model changes from native computer-use to OpenAI Chat #then computer is deactivated", () => {
	it("removes computer from active tools while preserving other macOS tools", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5" });

		await runModelSelect(pi, {
			api: "openai-completions",
			provider: "opengateway-dev",
			baseUrl: "https://dev-asmr-v2.sionic.im/v1",
		});

		expect(pi.getActiveTools()).toEqual([
			"list_apps",
			"get_app_state",
			"click",
			"perform_secondary_action",
			"set_value",
			"drag",
			"scroll",
			"type_text",
			"press_key",
		]);
	});
});

describe("#given enabled session #when model changes to direct OpenAI Responses #then computer is activated", () => {
	it("adds computer back only for direct OpenAI native computer-use", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi, {
			api: "openai-completions",
			provider: "opengateway-dev",
			baseUrl: "https://dev-asmr-v2.sionic.im/v1",
		});

		await runModelSelect(pi, {
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
		});

		expect(pi.getActiveTools()).toContain("computer");
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

describe("#given enabled session and OpenAI Chat Completions #when provider payload hook runs #then fallback computer function is stripped", () => {
	it("removes the computer function before OpenAI-compatible Chat providers see it", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);
		const shellTool = { type: "function", function: { name: "shell", parameters: { type: "object" } } };
		const payload = {
			tools: [{ type: "function", function: { name: "computer", parameters: { type: null } } }, shellTool],
		};

		const result = runBeforeProviderRequest(pi, "openai-completions", payload);

		expect(result).toEqual({ tools: [shellTool] });
	});
});

describe("#given enabled session and OpenAI Responses #when provider payload hook runs #then native computer tool is added", () => {
	it("appends the OpenAI computer tool for direct OpenAI", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);
		const computerFunction = { type: "function", name: "computer", parameters: { anyOf: [] } };
		const shellTool = { type: "function", name: "shell" };

		const result = runBeforeProviderRequest(
			pi,
			{ api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1" },
			{ tools: [computerFunction, shellTool] },
		);

		expect(result).toEqual({ tools: [shellTool, { type: "computer" }] });
	});

	it("leaves OpenAI-compatible proxy payloads on Codex-style tools", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);
		const getStateTool = { type: "function", name: "get_app_state" };
		const payload = { tools: [{ type: "function", name: "computer", parameters: { anyOf: [] } }, getStateTool] };

		const result = runBeforeProviderRequest(
			pi,
			{ api: "openai-responses", provider: "openai", baseUrl: "https://quotio.mengmota.com/v1" },
			payload,
		);

		expect(result).toEqual({ tools: [getStateTool] });
	});
});


describe("#given unsupported Anthropic model #when provider payload hook runs #then native computer tool is not injected", () => {
	it.each(["claude-opus-4-8", "claude-opus-4-6", "claude-future-9-0", undefined])(
		"leaves the payload untouched for %s",
		async (modelId) => {
			const pi = createMockPi();
			macosCuaExtension(pi);
			await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: modelId });

			const payload = { messages: [] };
			const result = runBeforeProviderRequest(
				pi,
				{ api: "anthropic-messages", provider: "anthropic", id: modelId },
				payload,
			);

			expect(result).toBe(payload);
		},
	);
});

describe("#given unsupported Anthropic model #when agent prompt hook runs #then Codex computer guidance is used", () => {
	it("adds Codex tool guidance without native computer dimensions", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: "claude-opus-4-8" });

		const result = await runBeforeAgentStart(pi, {
			api: "anthropic-messages",
			provider: "anthropic",
			id: "claude-opus-4-8",
		});

		expect(result).toEqual({
			systemPrompt: expect.stringContaining("Use Codex tools"),
		});
		expect(result).toEqual({
			systemPrompt: expect.not.stringContaining("1280x720"),
		});
	});
});

describe("#given supported sonnet session #when provider payload hook runs #then downscaled native computer tool is added", () => {
	it("injects Anthropic computer use with 1280x720 display dimensions", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5" });

		const result = runBeforeProviderRequest(
			pi,
			{ api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5" },
			{ messages: [] },
		);

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
	it("adds Anthropic native computer prompt for supported sonnet model", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi, { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5" });

		const result = await runBeforeAgentStart(pi, {
			api: "anthropic-messages",
			provider: "anthropic",
			id: "claude-sonnet-4-5",
		});

		expect(result).toEqual({
			systemPrompt: expect.stringContaining("1280x720"),
		});
	});

	it("does not add an OpenAI computer prompt", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		await runSessionStart(pi);

		const result = await runBeforeAgentStart(pi, "openai-responses");

		expect(result).toBeUndefined();
	});
});
