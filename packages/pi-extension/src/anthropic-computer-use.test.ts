import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ANTHROPIC_COMPUTER_USE_BETA,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
	type ComputerActionDriver,
	ComputerUseError,
	addAnthropicComputerUseToPayload,
	executeNativeComputerAction,
} from "./anthropic-computer-use.js";

function createComputer(): ComputerActionDriver {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn<ComputerActionDriver["screenshot"]>().mockResolvedValue({
			data: Buffer.from("png"),
			mimeType: "image/png",
			width: 100,
			height: 80,
		}),
		move: vi.fn<ComputerActionDriver["move"]>().mockResolvedValue(undefined),
		click: vi.fn<ComputerActionDriver["click"]>().mockResolvedValue(undefined),
		rightClick: vi.fn<ComputerActionDriver["rightClick"]>().mockResolvedValue(undefined),
		middleClick: vi.fn<ComputerActionDriver["middleClick"]>().mockResolvedValue(undefined),
		doubleClick: vi.fn<ComputerActionDriver["doubleClick"]>().mockResolvedValue(undefined),
		type: vi.fn<ComputerActionDriver["type"]>().mockResolvedValue(undefined),
		key: vi.fn<ComputerActionDriver["key"]>().mockResolvedValue(undefined),
		scroll: vi.fn<ComputerActionDriver["scroll"]>().mockResolvedValue(undefined),
		drag: vi.fn<ComputerActionDriver["drag"]>().mockResolvedValue(undefined),
		getCursorPosition: vi.fn<ComputerActionDriver["getCursorPosition"]>().mockResolvedValue({ x: 7, y: 9 }),
		getScreenSize: vi.fn<ComputerActionDriver["getScreenSize"]>().mockResolvedValue({ width: 100, height: 80 }),
		close: vi.fn<ComputerActionDriver["close"]>().mockResolvedValue(undefined),
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("#given a non-Anthropic provider #when adding computer use #then payload is untouched", () => {
	it("returns the original payload reference", () => {
		const payload = { messages: [] };

		const result = addAnthropicComputerUseToPayload("openai-responses", payload, { width: 1920, height: 1080 });

		expect(result).toBe(payload);
	});
});

describe("#given a non-record payload #when adding computer use #then payload is untouched", () => {
	it("returns the original payload value", () => {
		const payload = "not-a-record";

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, { width: 1920, height: 1080 });

		expect(result).toBe(payload);
	});
});

describe("#given a fresh Anthropic payload #when adding computer use #then beta and native tool are injected", () => {
	it("adds headers, extra_body betas, and display-sized computer tool", () => {
		const payload = { messages: [] };

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, { width: 2560, height: 1600 });

		expect(result).toEqual({
			messages: [],
			tools: [
				{
					type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
					name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
					display_width_px: 2560,
					display_height_px: 1600,
				},
			],
			headers: { "anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA },
			extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] },
		});
	});
});

describe("#given an existing Anthropic beta header #when adding computer use #then beta is comma-deduped", () => {
	it("does not duplicate the computer-use beta header", () => {
		const payload = { headers: { "anthropic-beta": `foo, ${ANTHROPIC_COMPUTER_USE_BETA}` } };

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, { width: 1, height: 2 });

		expect(result).toMatchObject({
			headers: { "anthropic-beta": `foo,${ANTHROPIC_COMPUTER_USE_BETA}` },
		});
	});
});

describe("#given an existing extra_body beta #when adding computer use #then beta array is deduped", () => {
	it("does not duplicate the computer-use beta entry", () => {
		const payload = { extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] } };

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, { width: 1, height: 2 });

		expect(result).toMatchObject({ extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] } });
	});
});

describe("#given a function-shaped computer tool #when adding computer use #then native variant replaces it", () => {
	it("strips the function-shaped duplicate before injection", () => {
		const unrelatedTool = { name: "other", input_schema: {} };
		const payload = {
			tools: [{ name: "computer", input_schema: {} }, unrelatedTool],
		};

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, { width: 1440, height: 900 });

		expect(result).toMatchObject({
			tools: [
				unrelatedTool,
				{
					type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
					name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
					display_width_px: 1440,
					display_height_px: 900,
				},
			],
		});
	});
});

describe("#given unrelated payload fields #when adding computer use #then existing values are preserved", () => {
	it("keeps unrelated tools, headers, and extra_body keys", () => {
		const unrelatedTool = { name: "shell", input_schema: { type: "object" } };
		const payload = {
			tools: [unrelatedTool],
			headers: { "x-custom": "kept" },
			extra_body: { temperature: 0.2, betas: ["other-beta"] },
		};

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, { width: 800, height: 600 });

		expect(result).toMatchObject({
			tools: [
				unrelatedTool,
				{
					type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
					name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
					display_width_px: 800,
					display_height_px: 600,
				},
			],
			headers: { "x-custom": "kept", "anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA },
			extra_body: { temperature: 0.2, betas: ["other-beta", ANTHROPIC_COMPUTER_USE_BETA] },
		});
	});
});

describe("#given screenshot action #when executed #then image content is returned", () => {
	it("returns PNG mime content", async () => {
		const computer = createComputer();

		const result = await executeNativeComputerAction({ action: "screenshot" }, computer);

		expect(result.content).toEqual([
			{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
		]);
	});
});

describe("#given left_click action #when executed #then click runs once and screenshot is returned", () => {
	it("dispatches click to the computer", async () => {
		const computer = createComputer();

		const result = await executeNativeComputerAction({ action: "left_click", coordinate: [10, 20] }, computer);

		expect(computer.click).toHaveBeenCalledTimes(1);
		expect(computer.click).toHaveBeenCalledWith({ x: 10, y: 20 });
		expect(result.content).toEqual([
			{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
		]);
	});
});

describe("#given key combo action #when executed #then combo is split into key and modifiers", () => {
	it("splits cmd+shift+t", async () => {
		const computer = createComputer();

		await executeNativeComputerAction({ action: "key", text: "cmd+shift+t" }, computer);

		expect(computer.key).toHaveBeenCalledWith("t", { modifiers: ["cmd", "shift"] });
	});
});

describe("#given triple_click action #when executed #then click runs three times", () => {
	it("dispatches three clicks", async () => {
		const computer = createComputer();

		await executeNativeComputerAction({ action: "triple_click", coordinate: [3, 4] }, computer);

		expect(computer.click).toHaveBeenCalledTimes(3);
		expect(computer.click).toHaveBeenNthCalledWith(1, { x: 3, y: 4 });
		expect(computer.click).toHaveBeenNthCalledWith(2, { x: 3, y: 4 });
		expect(computer.click).toHaveBeenNthCalledWith(3, { x: 3, y: 4 });
	});
});

describe("#given wait action #when executed #then it resolves after duration", () => {
	it("uses the provided seconds duration", async () => {
		vi.useFakeTimers();
		const computer = createComputer();

		const resultPromise = executeNativeComputerAction({ action: "wait", duration: 0.25 }, computer);
		await vi.advanceTimersByTimeAsync(250);

		await expect(resultPromise).resolves.toEqual({
			content: [{ type: "text", text: "wait complete" }],
			details: undefined,
		});
		expect(computer.screenshot).not.toHaveBeenCalled();
	});
});

describe("#given unsupported mouse phase action #when executed #then tagged error is thrown", () => {
	it("throws ComputerUseError with unsupported_action kind", async () => {
		const computer = createComputer();

		await expect(executeNativeComputerAction({ action: "left_mouse_down" }, computer)).rejects.toBeInstanceOf(
			ComputerUseError,
		);
		await expect(executeNativeComputerAction({ action: "left_mouse_down" }, computer)).rejects.toMatchObject({
			action: "left_mouse_down",
			kind: "unsupported_action",
			message: "Use macos_cua_* tools for fine-grained mouse phases",
		});
	});
});
