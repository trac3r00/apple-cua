import { afterEach, describe, expect, it, vi } from "vitest";

import { type ComputerActionDriver, ComputerUseError } from "./anthropic-computer-use.js";
import type { DisplayConfig } from "./computer-use/coords.js";
import {
	addOpenAIComputerUseToPayload,
	executeOpenAIComputerAction,
	normalizeOpenAIKeys,
	sanitizeOpenAIComputerUsePayload,
} from "./openai-computer-use.js";

const DISPLAY = {
	logicalWidth: 200,
	logicalHeight: 200,
	modelWidth: 100,
	modelHeight: 100,
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
			height: 100,
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
		getScreenSize: vi.fn<ComputerActionDriver["getScreenSize"]>().mockResolvedValue({ width: 100, height: 100 }),
		getAppState: vi.fn<ComputerActionDriver["getAppState"]>().mockResolvedValue({
			app: "TestApp",
			bundleId: "com.test.app",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [],
			screenshotBase64: "",
			screenshotWidth: 100,
			screenshotHeight: 100,
		}),
		listApps: vi.fn<ComputerActionDriver["listApps"]>().mockResolvedValue([]),
		setValue: vi.fn<ComputerActionDriver["setValue"]>().mockResolvedValue(undefined),
		performAction: vi.fn<ComputerActionDriver["performAction"]>().mockResolvedValue(undefined),
		close: vi.fn<ComputerActionDriver["close"]>().mockResolvedValue(undefined),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

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

describe("#given OpenAI click actions #when executed #then buttons and keys map to macOS calls", () => {
	it("dispatches left, right, and wheel clicks", async () => {
		const computer = createComputer();

		await executeOpenAIComputerAction(
			{ type: "click", button: "left", x: 10, y: 20, keys: ["Control"] },
			computer,
			DISPLAY,
		);
		await executeOpenAIComputerAction({ type: "click", button: "right", x: 30, y: 40 }, computer, DISPLAY);
		await executeOpenAIComputerAction({ type: "click", button: "wheel", x: 50, y: 60 }, computer, DISPLAY);

		expect(computer.key).toHaveBeenCalledWith("control");
		expect(computer.click).toHaveBeenCalledWith({ x: 20, y: 40 });
		expect(computer.rightClick).toHaveBeenCalledWith({ x: 60, y: 80 });
		expect(computer.middleClick).toHaveBeenCalledWith({ x: 100, y: 120 });
	});
});

describe("#given OpenAI drag and keypress actions #when executed #then paths and modifiers are translated", () => {
	it("collapses drag paths and parses keypresses", async () => {
		const computer = createComputer();
		const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await executeOpenAIComputerAction(
			{
				type: "drag",
				path: [
					{ x: 1, y: 2 },
					{ x: 3, y: 4 },
					{ x: 5, y: 6 },
				],
			},
			computer,
			DISPLAY,
		);
		await executeOpenAIComputerAction({ type: "keypress", keys: ["Control", "c"] }, computer, DISPLAY);

		expect(computer.drag).toHaveBeenCalledWith({ from: { x: 2, y: 4 }, to: { x: 10, y: 12 } });
		expect(stderrWrite).toHaveBeenCalledWith("macos-cua: collapsed OpenAI drag path to endpoints\n");
		expect(computer.key).toHaveBeenCalledWith("c", { modifiers: ["control"] });
		expect(normalizeOpenAIKeys(["Meta", "Enter"])).toEqual({ modifiers: ["command"], key: "enter" });
	});
});

describe("#given OpenAI scroll and screenshot actions #when executed #then direction and explicit screenshot are correct", () => {
	it("handles both axes and requests model-sized screenshot payloads", async () => {
		const rawPng = Buffer.alloc(100, 1);
		const computer = createComputer();
		vi.mocked(computer.screenshot).mockResolvedValue({
			data: rawPng,
			mimeType: "image/png",
			width: 100,
			height: 100,
		});

		const firstScroll = await executeOpenAIComputerAction(
			{ type: "scroll", scroll_x: 5, scroll_y: 30, x: 10, y: 20 },
			computer,
			DISPLAY,
		);
		const secondScroll = await executeOpenAIComputerAction(
			{ type: "scroll", scroll_x: -50, scroll_y: 10, x: 15, y: 25 },
			computer,
			DISPLAY,
		);
		const result = await executeOpenAIComputerAction({ type: "screenshot" }, computer, DISPLAY);

		expect(computer.scroll).toHaveBeenNthCalledWith(1, { direction: "down", amount: 30 });
		expect(computer.scroll).toHaveBeenNthCalledWith(2, { direction: "left", amount: 50 });
		expect(firstScroll.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, type: "scroll" }) }]);
		expect(secondScroll.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, type: "scroll" }) }]);
		expect(computer.screenshot).toHaveBeenCalledWith({ targetSize: { width: 100, height: 100 } });
		expect(result.content).toEqual([{ type: "image", data: rawPng.toString("base64"), mimeType: "image/png" }]);
	});
});

describe("#given browser navigation click #when executed #then unsupported action is rejected", () => {
	it("throws a tagged ComputerUseError", async () => {
		const computer = createComputer();

		await expect(
			executeOpenAIComputerAction({ type: "click", button: "back", x: 1, y: 2 }, computer, DISPLAY),
		).rejects.toMatchObject({ kind: "unsupported_action" });
		await expect(
			executeOpenAIComputerAction({ type: "click", button: "forward", x: 1, y: 2 }, computer, DISPLAY),
		).rejects.toBeInstanceOf(ComputerUseError);
	});
});
