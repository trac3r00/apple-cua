import { describe, expect, it } from "vitest";

import { RecordingComputer } from "../test/support/recording-computer.js";
import {
	ANTHROPIC_COMPUTER_USE_BETA,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
	ComputerUseError,
	addAnthropicComputerUseToPayload,
	executeNativeComputerAction,
	supportsAnthropicNativeComputerUse,
} from "./anthropic-computer-use.js";
import type { DisplayConfig } from "./computer-use/coords.js";

const WINDOW_DISPLAY = {
	logicalWidth: 1280,
	logicalHeight: 720,
	modelWidth: 1280,
	modelHeight: 720,
} satisfies DisplayConfig;

const SMALL_DISPLAY = {
	logicalWidth: 100,
	logicalHeight: 80,
	modelWidth: 100,
	modelHeight: 80,
} satisfies DisplayConfig;

describe("#given a non-Anthropic provider #when adding computer use #then payload is untouched", () => {
	it("returns the original payload reference", () => {
		const payload = { messages: [] };

		const result = addAnthropicComputerUseToPayload("openai-responses", payload, WINDOW_DISPLAY);

		expect(result).toBe(payload);
	});
});

describe("#given a non-record payload #when adding computer use #then payload is untouched", () => {
	it("returns the original payload value", () => {
		const payload = "not-a-record";

		const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, WINDOW_DISPLAY);

		expect(result).toBe(payload);
	});
});

describe("#given unknown or unsupported model #when adding computer use #then payload is untouched (safe default)", () => {
	it.each([undefined, "claude-future-9-0", "some-unknown-model", "claude-opus-5-0"])(
		"skips native injection for %s",
		(modelId) => {
			const payload = { messages: [] };

			const result = addAnthropicComputerUseToPayload("anthropic-messages", payload, WINDOW_DISPLAY, modelId);

			expect(result).toBe(payload);
			expect(supportsAnthropicNativeComputerUse(modelId)).toBe(false);
		},
	);
});

describe("#given a documented computer-use model #when checking support #then returns true", () => {
	it.each([
		"claude-sonnet-4-5",
		"claude-sonnet-4-20250514",
		"claude-3-7-sonnet-20250219",
		"claude-3-5-sonnet-20241022",
		"claude-opus-4-20250514",
		"claude-opus-4-6",
		"claude-haiku-4-5",
	])("supports %s", (modelId) => {
		expect(supportsAnthropicNativeComputerUse(modelId)).toBe(true);
	});
});

describe("#given a fresh Anthropic payload #when adding computer use #then beta and native tool are injected", () => {
	it("adds headers, extra_body betas, and the declared display dimensions", () => {
		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			{ messages: [] },
			WINDOW_DISPLAY,
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
			WINDOW_DISPLAY,
			"claude-sonnet-4-5",
		);

		expect(result).toMatchObject({ headers: { "anthropic-beta": `foo,${ANTHROPIC_COMPUTER_USE_BETA}` } });
	});
});

describe("#given an existing extra_body beta #when adding computer use #then beta array is deduped", () => {
	it("does not duplicate the computer-use beta entry", () => {
		const payload = { extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] } };

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			WINDOW_DISPLAY,
			"claude-sonnet-4-5",
		);

		expect(result).toMatchObject({ extra_body: { betas: [ANTHROPIC_COMPUTER_USE_BETA] } });
	});
});

describe("#given a function-shaped computer tool #when adding computer use #then native variant replaces it", () => {
	it("strips the function-shaped duplicate before injection and keeps unrelated tools and fields", () => {
		const unrelatedTool = { name: "shell", input_schema: { type: "object" } };
		const payload = {
			tools: [{ name: "computer", input_schema: {} }, unrelatedTool],
			headers: { "x-custom": "kept" },
			extra_body: { temperature: 0.2, betas: ["other-beta"] },
		};

		const result = addAnthropicComputerUseToPayload(
			"anthropic-messages",
			payload,
			SMALL_DISPLAY,
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

describe("#given Anthropic pointer actions #when executed #then each becomes one guarded click or drag", () => {
	it.each([
		["left_click", { button: "left", count: 1 }],
		["right_click", { button: "right", count: 1 }],
		["middle_click", { button: "middle", count: 1 }],
		["double_click", { button: "left", count: 2 }],
		["triple_click", { button: "left", count: 3 }],
	] as const)("maps %s", async (action, click) => {
		const computer = new RecordingComputer();

		await executeNativeComputerAction({ action, coordinate: [10, 20] }, computer);

		expect(computer.calls).toEqual([
			{ method: "click", point: { x: 10, y: 20 }, options: { ...click, modifiers: [] } },
		]);
	});

	it("maps left_click_drag from start_coordinate to coordinate", async () => {
		const computer = new RecordingComputer();

		await executeNativeComputerAction(
			{ action: "left_click_drag", start_coordinate: [1, 2], coordinate: [3, 4] },
			computer,
		);

		expect(computer.calls).toEqual([{ method: "drag", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }]);
	});

	it("refuses a click without a coordinate before anything is sent", async () => {
		const computer = new RecordingComputer();

		await expect(executeNativeComputerAction({ action: "left_click" }, computer)).rejects.toMatchObject({
			kind: "invalid_arguments",
		});
		expect(computer.calls).toEqual([]);
	});
});

describe("#given Anthropic keyboard actions #when executed #then they become press_keys and type_text entries", () => {
	it("passes a chord through and splits an xdotool key sequence", async () => {
		const computer = new RecordingComputer();

		await executeNativeComputerAction({ action: "key", text: "cmd+shift+t" }, computer);
		await executeNativeComputerAction({ action: "key", text: "ctrl+a BackSpace" }, computer);

		expect(computer.calls).toEqual([
			{ method: "pressKeys", keys: ["cmd+shift+t"] },
			{ method: "pressKeys", keys: ["ctrl+a", "BackSpace"] },
		]);
	});

	it("holds a key for the requested seconds", async () => {
		const computer = new RecordingComputer();

		await executeNativeComputerAction({ action: "hold_key", text: "shift", duration: 2 }, computer);

		expect(computer.calls).toEqual([{ method: "pressKeys", keys: [{ key: "shift", hold_seconds: 2 }] }]);
	});

	it("types literal text, including IME text", async () => {
		const computer = new RecordingComputer();

		await executeNativeComputerAction({ action: "type", text: "안녕하세요" }, computer);

		expect(computer.calls).toEqual([{ method: "typeText", text: "안녕하세요" }]);
	});
});

describe("#given screenshot and wait #when executed #then the window is observed or the delay is local", () => {
	it("observes through the computer and waits a capped duration", async () => {
		const computer = new RecordingComputer();

		await executeNativeComputerAction({ action: "screenshot" }, computer);
		const waited = await executeNativeComputerAction({ action: "wait", duration: 0.25 }, computer);
		await executeNativeComputerAction({ action: "wait", duration: 60 }, computer);

		expect(computer.calls).toEqual([
			{ method: "screenshot" },
			{ method: "wait", milliseconds: 250 },
			{ method: "wait", milliseconds: 10_000 },
		]);
		expect(waited.content).toEqual([{ type: "text", text: "wait complete" }]);
	});
});

describe("#given an action apple-cua-mcp cannot perform #when executed #then it is refused by name, not faked", () => {
	it.each(["scroll", "mouse_move", "cursor_position", "left_mouse_down", "left_mouse_up"] as const)(
		"refuses %s without sending anything",
		async (action) => {
			const computer = new RecordingComputer();

			await expect(
				executeNativeComputerAction(
					{ action, coordinate: [1, 2], scroll_direction: "down", scroll_amount: 3 },
					computer,
				),
			).rejects.toMatchObject({ kind: "unsupported_action", action });
			expect(computer.calls).toEqual([]);
		},
	);
});

describe("#given the server refuses an action #when executed #then the refusal surfaces as a tagged error", () => {
	it("wraps the bridge error with its message", async () => {
		const computer = new RecordingComputer();
		computer.click = async () => {
			throw new Error('{"reason":"app-not-approved"}');
		};

		const failure = executeNativeComputerAction({ action: "left_click", coordinate: [1, 1] }, computer);

		await expect(failure).rejects.toBeInstanceOf(ComputerUseError);
		await expect(failure).rejects.toMatchObject({
			kind: "execution_failed",
			action: "left_click",
			message: '{"reason":"app-not-approved"}',
		});
	});
});
