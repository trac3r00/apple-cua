import { afterEach, describe, expect, it } from "vitest";

import {
	FAKE_TOOLS,
	type FakeAppleCuaServer,
	guardedWindowServer,
	textAnswer,
} from "../test/support/fake-apple-cua.js";
import { type MockPi, createMockPi } from "../test/support/mock-pi.js";
import macosCuaExtension, { createMacosCuaExtension } from "./index.js";
import type { Environment } from "./launcher.js";

interface TestModel {
	readonly api: string;
	readonly baseUrl?: string;
	readonly provider?: string;
	readonly id?: string;
}

const SONNET = { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-4-5" } as const;
const OPENAI_DIRECT = { api: "openai-responses", provider: "openai", baseUrl: "https://api.openai.com/v1" } as const;
const OPENAI_CHAT_PROXY = {
	api: "openai-completions",
	provider: "opengateway-dev",
	baseUrl: "https://dev-asmr-v2.sionic.im/v1",
} as const;
const INSTRUCTIONS = "Set a goal, call get_app_state, act once with its observation_token.";
const MCP_TOOL_NAMES = FAKE_TOOLS.map((tool) => tool.name);

const started: MockPi[] = [];

async function startSession(
	options: { readonly fake?: FakeAppleCuaServer; readonly env?: Environment; readonly model?: TestModel } = {},
): Promise<{ readonly pi: MockPi; readonly fake: FakeAppleCuaServer }> {
	const fake = options.fake ?? guardedWindowServer();
	const pi = createMockPi();
	createMacosCuaExtension({ connect: fake.connect, env: options.env ?? {} })(pi);
	await pi.emit("session_start", { type: "session_start", reason: "startup" }, { model: options.model });
	started.push(pi);
	return { pi, fake };
}

afterEach(async () => {
	for (const pi of started.splice(0)) {
		await pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
	}
});

describe("#given macosCuaExtension #when imported #then default export is a named function", () => {
	it("is a function named macosCuaExtension", () => {
		expect(typeof macosCuaExtension).toBe("function");
		expect(macosCuaExtension.name).toBe("macosCuaExtension");
	});
});

describe("#given a pi API #when the extension factory runs #then lifecycle handlers are registered", () => {
	it("registers resources, session, model, request, prompt and shutdown handlers and starts nothing yet", () => {
		const fake = guardedWindowServer();
		const pi = createMockPi();

		createMacosCuaExtension({ connect: fake.connect, env: {} })(pi);

		expect([...pi.handlers.keys()]).toEqual([
			"resources_discover",
			"session_start",
			"model_select",
			"before_provider_request",
			"before_agent_start",
			"session_shutdown",
		]);
		expect(fake.connections).toBe(0);
	});

	it("returns the apple-cua skill path for resources_discover", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);

		const result = await pi.emit("resources_discover", { type: "resources_discover", reason: "startup" });

		expect(result).toEqual({ skillPaths: [expect.stringContaining("skills/apple-cua/SKILL.md")] });
	});
});

describe("#given session_start #when the server answers tools/list #then its tools are registered, then computer", () => {
	it("registers one pi tool per MCP tool with the server's name, description and schema", async () => {
		const { pi } = await startSession();

		expect([...pi.tools.keys()]).toEqual([...MCP_TOOL_NAMES, "computer"]);
		const click = pi.tools.get("click");
		expect(click?.description).toBe(FAKE_TOOLS.find((tool) => tool.name === "click")?.description);
		expect(click?.parameters).not.toHaveProperty("$schema");
		expect(click?.executionMode).toBe("sequential");
	});

	it("leaves computer out when APPLE_CUA_DISABLE_COMPUTER_USE_BETA opts out", async () => {
		const { pi } = await startSession({ env: { APPLE_CUA_DISABLE_COMPUTER_USE_BETA: "1" } });

		expect([...pi.tools.keys()]).toEqual(MCP_TOOL_NAMES);
	});

	it("starts one server per session and stops it at shutdown", async () => {
		const { pi, fake } = await startSession();

		await pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

		expect(fake.connections).toBe(1);
		expect(fake.closedConnections).toBe(1);
	});

	it("fails session_start with the launch error and registers nothing when the server cannot start", async () => {
		const pi = createMockPi();
		createMacosCuaExtension({
			connect: async () => {
				throw new Error("apple-cua: cannot find apple-cua-mcp. Run `apple-cua doctor`");
			},
			env: {},
		})(pi);

		await expect(pi.emit("session_start", { type: "session_start", reason: "startup" })).rejects.toThrow(
			/apple-cua doctor/,
		);
		expect(pi.tools.size).toBe(0);
	});
});

describe("#given a bridged tool #when pi calls it #then the call reaches the server and the answer comes back", () => {
	it("returns list_apps from the server", async () => {
		const fake = guardedWindowServer().handle("list_apps", () => textAnswer([{ name: "Notes" }]));
		const { pi } = await startSession({ fake });

		const result = await pi.tools.get("list_apps")?.run({});

		expect(fake.callsTo("list_apps")).toHaveLength(1);
		expect(result?.content).toEqual([{ type: "text", text: '[{"name":"Notes"}]' }]);
	});
});

describe("#given the native computer tool #when the model observes then acts #then guarded MCP calls carry the token", () => {
	it("clicks the observed window with the observation's token, and screenshots re-observe it", async () => {
		const { pi, fake } = await startSession({ model: SONNET });

		await pi.tools.get("get_app_state")?.run({ app: "Notes" });
		await pi.tools.get("computer")?.run({ action: "left_click", coordinate: [40, 30] });
		const screenshot = await pi.tools.get("computer")?.run({ action: "screenshot" });

		expect(fake.calls.map((call) => call.name)).toEqual(["get_app_state", "click", "get_app_state"]);
		expect(fake.callsTo("click")[0]?.args).toEqual({ app: "Notes", observation_token: "token-1", x: 40, y: 30 });
		expect(screenshot?.content[0]).toEqual({ type: "image", data: "d2luZG93", mimeType: "image/jpeg" });
	});

	it("refuses a coordinate scroll by name instead of sending anything", async () => {
		const { pi, fake } = await startSession({ model: SONNET });
		await pi.tools.get("get_app_state")?.run({ app: "Notes" });

		await expect(
			pi.tools
				.get("computer")
				?.run({ action: "scroll", coordinate: [1, 1], scroll_direction: "down", scroll_amount: 3 }),
		).rejects.toThrow(/no apple-cua-mcp equivalent/);
		expect(fake.calls.map((call) => call.name)).toEqual(["get_app_state"]);
	});
});

describe("#given models #when the session starts or the model changes #then computer is active only where native", () => {
	it.each(["claude-sonnet-4-5", "claude-opus-4-6", "claude-haiku-4-5"])("activates computer for %s", async (id) => {
		const { pi } = await startSession({ model: { api: "anthropic-messages", provider: "anthropic", id } });

		expect(pi.getActiveTools()).toContain("computer");
	});

	it.each([
		{ api: "anthropic-messages", provider: "anthropic", id: "claude-future-9-0" },
		{ api: "anthropic-messages", provider: "anthropic" },
		OPENAI_CHAT_PROXY,
		{ api: "openai-responses", provider: "openai", baseUrl: "https://quotio.mengmota.com/v1" },
		OPENAI_DIRECT,
	])("keeps computer registered but inactive for %o", async (model) => {
		const { pi } = await startSession({ model });

		expect(pi.tools.has("computer")).toBe(true);
		expect(pi.getActiveTools()).not.toContain("computer");
	});

	it("deactivates computer when the model changes to a Chat Completions proxy, keeping the MCP tools", async () => {
		const { pi } = await startSession({ model: SONNET });

		await pi.emit("model_select", { model: OPENAI_CHAT_PROXY }, { model: OPENAI_CHAT_PROXY });

		expect(pi.getActiveTools()).toEqual(MCP_TOOL_NAMES);
	});

	it("activates computer for direct OpenAI Responses once the operator opts in", async () => {
		const { pi } = await startSession({ env: { APPLE_CUA_OPENAI_NATIVE_TRANSPORT: "1" }, model: OPENAI_CHAT_PROXY });

		await pi.emit("model_select", { model: OPENAI_DIRECT }, { model: OPENAI_DIRECT });

		expect(pi.getActiveTools()).toContain("computer");
	});
});

describe("#given the provider payload hook #when requests go out #then native shapes follow the observed window", () => {
	it("declares the placeholder display before any observation and the window screenshot after", async () => {
		const { pi } = await startSession({ model: SONNET });

		const before = await pi.emit("before_provider_request", { payload: { messages: [] } }, { model: SONNET });
		await pi.tools.get("get_app_state")?.run({ app: "Notes" });
		const after = await pi.emit("before_provider_request", { payload: { messages: [] } }, { model: SONNET });

		expect(before).toMatchObject({
			tools: [{ type: "computer_20250124", name: "computer", display_width_px: 1280, display_height_px: 800 }],
			headers: { "anthropic-beta": "computer-use-2025-01-24" },
			extra_body: { betas: ["computer-use-2025-01-24"] },
		});
		expect(after).toMatchObject({
			tools: [{ type: "computer_20250124", name: "computer", display_width_px: 1600, display_height_px: 1000 }],
		});
	});

	it("passes other providers through and strips the computer function from OpenAI payloads", async () => {
		const { pi } = await startSession();
		const payload = { tools: [] };
		const shellTool = { type: "function", function: { name: "shell", parameters: { type: "object" } } };

		const google = await pi.emit("before_provider_request", { payload }, { model: { api: "google-generative-ai" } });
		const chat = await pi.emit(
			"before_provider_request",
			{ payload: { tools: [{ type: "function", function: { name: "computer" } }, shellTool] } },
			{ model: OPENAI_CHAT_PROXY },
		);

		expect(google).toBe(payload);
		expect(chat).toEqual({ tools: [shellTool] });
	});

	it("adds the OpenAI computer tool for direct OpenAI only when the transport is opted in", async () => {
		const computerFunction = { type: "function", name: "computer", parameters: { anyOf: [] } };
		const shellTool = { type: "function", name: "shell" };
		const request = { payload: { tools: [computerFunction, shellTool] } };
		const { pi: defaultPi } = await startSession();
		const { pi: optedInPi } = await startSession({ env: { APPLE_CUA_OPENAI_NATIVE_TRANSPORT: "1" } });

		const byDefault = await defaultPi.emit("before_provider_request", request, { model: OPENAI_DIRECT });
		const optedIn = await optedInPi.emit("before_provider_request", request, { model: OPENAI_DIRECT });

		expect(byDefault).toEqual({ tools: [shellTool] });
		expect(optedIn).toEqual({ tools: [shellTool, { type: "computer" }] });
	});

	it("leaves payloads untouched once the session has ended", async () => {
		const { pi } = await startSession({ model: SONNET });
		await pi.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
		const payload = { messages: [] };

		const result = await pi.emit("before_provider_request", { payload }, { model: SONNET });

		expect(result).toBe(payload);
	});
});

describe("#given the agent prompt hook #when a turn starts #then the server's instructions reach every model", () => {
	it("adds the instructions for any model and the computer section only for native Anthropic models", async () => {
		const { pi } = await startSession({ fake: guardedWindowServer({ instructions: INSTRUCTIONS }), model: SONNET });
		const event = { systemPrompt: "base prompt" };

		const sonnet = await pi.emit("before_agent_start", event, { model: SONNET });
		const openai = await pi.emit("before_agent_start", event, { model: OPENAI_DIRECT });

		expect(sonnet).toEqual({ systemPrompt: expect.stringContaining(INSTRUCTIONS) });
		expect(sonnet).toEqual({ systemPrompt: expect.stringContaining("`computer`") });
		expect(openai).toEqual({ systemPrompt: expect.stringContaining(INSTRUCTIONS) });
		expect(openai).toEqual({ systemPrompt: expect.not.stringContaining("`computer`") });
	});

	it("adds nothing when the server sends no instructions and the model has no native computer tool", async () => {
		const { pi } = await startSession();

		const result = await pi.emit("before_agent_start", { systemPrompt: "base prompt" }, { model: OPENAI_DIRECT });

		expect(result).toBeUndefined();
	});
});
