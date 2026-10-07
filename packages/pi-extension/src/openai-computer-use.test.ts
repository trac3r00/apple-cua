import { describe, expect, it } from "vitest";

import { RecordingComputer } from "../test/support/recording-computer.js";
import type { DisplayConfig } from "./computer-use/coords.js";
import {
	addOpenAIComputerUseToPayload,
	executeOpenAIComputerAction,
	normalizeOpenAIKeys,
	sanitizeOpenAIComputerUsePayload,
} from "./openai-computer-use.js";

const DISPLAY = {
	logicalWidth: 100,
	logicalHeight: 100,
	modelWidth: 100,
	modelHeight: 100,
} satisfies DisplayConfig;

describe("#given OpenAI payloads #when adding computer use #then passthrough and dedupe are honored", () => {
	it("passes through non-openai providers and dedupes native tool", () => {
		const payload = { tools: [{ type: "computer" }, { type: "function", name: "shell" }] };

		expect(addOpenAIComputerUseToPayload("anthropic-messages", payload, DISPLAY)).toBe(payload);
		expect(addOpenAIComputerUseToPayload("openai-responses", payload, DISPLAY)).toEqual(payload);
		expect(addOpenAIComputerUseToPayload("openai-responses", { tools: [] }, DISPLAY)).toEqual({
			tools: [{ type: "computer" }],
		});
	});

	it("strips the fallback computer function before OpenAI sees the payload", () => {
		const computerFunction = { type: "function", name: "computer", parameters: { anyOf: [] } };
		const nestedComputerFunction = { type: "function", function: { name: "computer" } };
		const shellTool = { type: "function", name: "shell" };

		expect(
			sanitizeOpenAIComputerUsePayload("openai-responses", {
				tools: [computerFunction, nestedComputerFunction, shellTool],
			}),
		).toEqual({ tools: [shellTool] });
		expect(
			addOpenAIComputerUseToPayload("openai-responses", { tools: [computerFunction, shellTool] }, DISPLAY),
		).toEqual({ tools: [shellTool, { type: "computer" }] });
	});
});

describe("#given OpenAI click actions #when executed #then buttons and held keys become one guarded click", () => {
	it("maps left with held modifiers, right, wheel and double click", async () => {
		const computer = new RecordingComputer();

		await executeOpenAIComputerAction(
			{ type: "click", button: "left", x: 10, y: 20, keys: ["CTRL", "Shift"] },
			computer,
		);
		await executeOpenAIComputerAction({ type: "click", button: "right", x: 30, y: 40 }, computer);
		await executeOpenAIComputerAction({ type: "click", button: "wheel", x: 50, y: 60 }, computer);
		await executeOpenAIComputerAction({ type: "double_click", x: 70, y: 80 }, computer);

		expect(computer.calls).toEqual([
			{
				method: "click",
				point: { x: 10, y: 20 },
				options: { button: "left", count: 1, modifiers: ["control", "shift"] },
			},
			{ method: "click", point: { x: 30, y: 40 }, options: { button: "right", count: 1, modifiers: [] } },
			{ method: "click", point: { x: 50, y: 60 }, options: { button: "middle", count: 1, modifiers: [] } },
			{ method: "click", point: { x: 70, y: 80 }, options: { button: "left", count: 2, modifiers: [] } },
		]);
	});

	it.each(["back", "forward"] as const)("refuses the %s button by name", async (button) => {
		const computer = new RecordingComputer();

		await expect(executeOpenAIComputerAction({ type: "click", button, x: 1, y: 2 }, computer)).rejects.toMatchObject({
			kind: "unsupported_action",
			action: "click",
		});
		expect(computer.calls).toEqual([]);
	});
});

describe("#given OpenAI drag and keypress actions #when executed #then paths and chords are translated", () => {
	it("drags between the two points of a path and presses a chord", async () => {
		const computer = new RecordingComputer();

		await executeOpenAIComputerAction(
			{
				type: "drag",
				path: [
					{ x: 1, y: 2 },
					{ x: 3, y: 4 },
				],
			},
			computer,
		);
		await executeOpenAIComputerAction({ type: "keypress", keys: ["CTRL", "C"] }, computer);

		expect(computer.calls).toEqual([
			{ method: "drag", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
			{ method: "pressKeys", keys: ["control+c"] },
		]);
		expect(normalizeOpenAIKeys(["Meta", "Enter"])).toEqual({ modifiers: ["command"], key: "enter" });
	});

	it("refuses a path through waypoints instead of collapsing it", async () => {
		const computer = new RecordingComputer();

		await expect(
			executeOpenAIComputerAction(
				{
					type: "drag",
					path: [
						{ x: 1, y: 2 },
						{ x: 3, y: 4 },
						{ x: 5, y: 6 },
					],
				},
				computer,
			),
		).rejects.toMatchObject({ kind: "unsupported_action", action: "drag" });
		await expect(
			executeOpenAIComputerAction({ type: "drag", path: [{ x: 1, y: 2 }] }, computer),
		).rejects.toMatchObject({ kind: "invalid_arguments" });
		expect(computer.calls).toEqual([]);
	});
});

describe("#given OpenAI move and scroll #when executed #then they are refused by name", () => {
	it.each([
		{ type: "move", x: 1, y: 2 },
		{ type: "scroll", x: 1, y: 2, scroll_x: 0, scroll_y: 30 },
	] as const)("refuses $type", async (action) => {
		const computer = new RecordingComputer();

		await expect(executeOpenAIComputerAction(action, computer)).rejects.toMatchObject({
			kind: "unsupported_action",
			action: action.type,
		});
		expect(computer.calls).toEqual([]);
	});
});

describe("#given OpenAI screenshot, type and wait #when executed #then they map onto the computer", () => {
	it("observes, types and waits the default second", async () => {
		const computer = new RecordingComputer();

		await executeOpenAIComputerAction({ type: "screenshot" }, computer);
		await executeOpenAIComputerAction({ type: "type", text: "hello" }, computer);
		await executeOpenAIComputerAction({ type: "wait" }, computer);

		expect(computer.calls).toEqual([
			{ method: "screenshot" },
			{ method: "typeText", text: "hello" },
			{ method: "wait", milliseconds: 1000 },
		]);
	});
});
