import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ANTHROPIC_COMPUTER_USE_BETA,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
	type ComputerActionDriver,
	ComputerUseError,
	addAnthropicComputerUseToPayload,
	executeNativeComputerAction,
	supportsAnthropicNativeComputerUse,
} from "./anthropic-computer-use.js";
import type { DisplayConfig } from "./computer-use/coords.js";

const DEFAULT_DOWNSCALE = {
	logicalWidth: 2560,
	logicalHeight: 1440,
	modelWidth: 1280,
	modelHeight: 720,
} satisfies DisplayConfig;

const ONE_TO_ONE_DOWNSCALE = {
	logicalWidth: 100,
	logicalHeight: 80,
	modelWidth: 100,
	modelHeight: 80,
} satisfies DisplayConfig;

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
		setTarget: vi.fn<ComputerActionDriver["setTarget"]>(),
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
		getScreenshotViewport: vi.fn<ComputerActionDriver["getScreenshotViewport"]>().mockResolvedValue(undefined),
		getAppState: vi.fn<ComputerActionDriver["getAppState"]>().mockResolvedValue({
			app: "TestApp",
			bundleId: "com.test.app",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [],
			screenshotBase64: "",
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: vi.fn<ComputerActionDriver["listApps"]>().mockResolvedValue([]),
		setValue: vi.fn<ComputerActionDriver["setValue"]>().mockResolvedValue(undefined),
		performAction: vi.fn<ComputerActionDriver["performAction"]>().mockResolvedValue(undefined),
		pressAtPosition: vi.fn<ComputerActionDriver["pressAtPosition"]>().mockResolvedValue(false),
		typeIntoFocused: vi.fn<ComputerActionDriver["typeIntoFocused"]>().mockResolvedValue(false),
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

		const result = addAnthropicComputerUseToPayload("openai-responses", payload, DEFAULT_DOWNSCALE);

		expect(result).toBe(payload);
	});
});

describe("#given a non-record payload #when adding computer use #then payload is untouched", () => {
	it("returns the original payload value", () => {
		const payload = "not-a-record";

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, DEFAULT_DOWNSCALE);

		expect(result).toBe(payload);
	});
});

describe("#given unknown or unsupported model #when adding computer use #then payload is untouched (safe default)", () => {
	it.each([undefined, "claude-opus-4-6", "claude-opus-4-8", "claude-future-9-0", "some-unknown-model"])(
		"skips native injection for %s",
		(modelId) => {
			const payload = { messages: [] };

			const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, DEFAULT_DOWNSCALE, modelId);

			expect(result).toBe(payload);
			expect(supportsAnthropicNativeComputerUse(modelId)).toBe(false);
		},
	);
});

describe("#given supported sonnet model #when checking support #then returns true", () => {
	it.each(["claude-sonnet-4-5", "claude-3-5-sonnet-20241022"])("supports %s", (modelId) => {
		expect(supportsAnthropicNativeComputerUse(modelId)).toBe(true);
	});
});

describe("#given a fresh Anthropic payload #when adding computer use #then beta and native tool are injected", () => {
	it("adds headers, extra_body betas, and downscaled computer tool dimensions", () => {
		const payload = { messages: [] };

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			DEFAULT_DOWNSCALE,
			"claude-sonnet-4-5",
		);

		expect(result).toEqual({
			messages: [],
			tools: [
				{
					type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
					name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
					display_width_px: 1280,
					display_height_px: 720,
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

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			DEFAULT_DOWNSCALE,
			"claude-sonnet-4-5",
		);

		expect(result).toMatchObject({
			headers: { "anthropic-beta": `foo,${ANTHROPIC_COMPUTER_USE_BETA}` },
		});
	});
});

describe("#given an existing extra_body beta #when adding computer use #then beta array is deduped", () => {
	it("does not duplicate the computer-use beta entry", () => {
		const payload = { extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] } };

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			DEFAULT_DOWNSCALE,
			"claude-sonnet-4-5",
		);

		expect(result).toMatchObject({ extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] } });
	});
});

describe("#given a function-shaped computer tool #when adding computer use #then native variant replaces it", () => {
	it("strips the function-shaped duplicate before injection", () => {
		const unrelatedTool = { name: "other", input_schema: {} };
		const payload = {
			tools: [{ name: "computer", input_schema: {} }, unrelatedTool],
		};

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			DEFAULT_DOWNSCALE,
			"claude-sonnet-4-5",
		);

		expect(result).toMatchObject({
			tools: [
				unrelatedTool,
				{
					type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
					name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
					display_width_px: 1280,
					display_height_px: 720,
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

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			ONE_TO_ONE_DOWNSCALE,
			"claude-sonnet-4-5",
		);

		expect(result).toMatchObject({
			tools: [
				unrelatedTool,
				{
					type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
					name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
					display_width_px: 100,
					display_height_px: 80,
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

		const result = await executeNativeComputerAction({ action: "screenshot" }, computer, ONE_TO_ONE_DOWNSCALE);

		expect(result.content).toEqual([
			{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
		]);
	});
});

describe("#given left_click action #when executed #then click runs once and lightweight result is returned", () => {
	it("dispatches click to the computer", async () => {
		const computer = createComputer();

		const result = await executeNativeComputerAction(
			{ action: "left_click", coordinate: [10, 20] },
			computer,
			ONE_TO_ONE_DOWNSCALE,
		);

		expect(computer.click).toHaveBeenCalledTimes(1);
		expect(computer.click).toHaveBeenCalledWith({ x: 10, y: 20 });
		expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, action: "left_click" }) }]);
	});
});

describe("#given key combo action #when executed #then combo is split into key and modifiers", () => {
	it("splits cmd+shift+t", async () => {
		const computer = createComputer();

		await executeNativeComputerAction({ action: "key", text: "cmd+shift+t" }, computer, ONE_TO_ONE_DOWNSCALE);

		expect(computer.key).toHaveBeenCalledWith("t", { modifiers: ["cmd", "shift"] });
	});
});

describe("#given triple_click action #when executed #then click runs three times", () => {
	it("dispatches three clicks", async () => {
		const computer = createComputer();

		await executeNativeComputerAction({ action: "triple_click", coordinate: [3, 4] }, computer, ONE_TO_ONE_DOWNSCALE);

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

		const resultPromise = executeNativeComputerAction(
			{ action: "wait", duration: 0.25 },
			computer,
			ONE_TO_ONE_DOWNSCALE,
		);
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

		await expect(
			executeNativeComputerAction({ action: "left_mouse_down" }, computer, ONE_TO_ONE_DOWNSCALE),
		).rejects.toBeInstanceOf(ComputerUseError);
		await expect(
			executeNativeComputerAction({ action: "left_mouse_down" }, computer, ONE_TO_ONE_DOWNSCALE),
		).rejects.toMatchObject({
			action: "left_mouse_down",
			kind: "unsupported_action",
			message: "Use click or drag tools for fine-grained mouse phases",
		});
	});
});

describe("#given scaled Anthropic coordinates #when left click executes #then logical screen points are clicked", () => {
	it("unscales model-space coordinates before dispatch", async () => {
		const computer = createComputer();

		await executeNativeComputerAction({ action: "left_click", coordinate: [640, 360] }, computer, DEFAULT_DOWNSCALE);

		expect(computer.click).toHaveBeenCalledWith({ x: 1280, y: 720 });
	});
});

describe("#given a screenshot action #when screenshot action executes #then requested model dimensions are captured", () => {
	it("passes target dimensions into the screenshot call", async () => {
		const computer = createComputer();

		await executeNativeComputerAction({ action: "screenshot" }, computer, DEFAULT_DOWNSCALE);

		expect(computer.screenshot).toHaveBeenCalledWith({ targetSize: { width: 1280, height: 720 } });
	});
});
