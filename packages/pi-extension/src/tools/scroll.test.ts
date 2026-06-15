import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createScrollTool } from "./scroll.js";

function createComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn<ComputerInterface["screenshot"]>(),
		setTarget: vi.fn<ComputerInterface["setTarget"]>(),
		move: vi.fn<ComputerInterface["move"]>(),
		click: vi.fn<ComputerInterface["click"]>(),
		rightClick: vi.fn<ComputerInterface["rightClick"]>(),
		middleClick: vi.fn<ComputerInterface["middleClick"]>(),
		doubleClick: vi.fn<ComputerInterface["doubleClick"]>(),
		type: vi.fn<ComputerInterface["type"]>(),
		key: vi.fn<ComputerInterface["key"]>(),
		scroll: vi.fn<ComputerInterface["scroll"]>(),
		drag: vi.fn<ComputerInterface["drag"]>(),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>(),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>(),
		getAppState: vi.fn<ComputerInterface["getAppState"]>(),
		getScreenshotViewport: vi.fn<ComputerInterface["getScreenshotViewport"]>().mockResolvedValue(undefined),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		selectText: vi.fn<ComputerInterface["selectText"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
		pressAtPosition: vi.fn<ComputerInterface["pressAtPosition"]>(),
		typeIntoFocused: vi.fn<ComputerInterface["typeIntoFocused"]>(),
		close: vi.fn<ComputerInterface["close"]>(),
	};
}

describe("#given scroll tool factory #when built #then tool name is Codex-compatible", () => {
	it("returns scroll", () => {
		const computer = createComputer();
		const tool = createScrollTool(computer);

		expect(tool.name).toBe("scroll");
	});
});

describe("#given scroll tool #when executed #then it performs AX and targeted wheel scroll", () => {
	it("performs AXScrollDownByPage on the element_index pages and sends targeted wheel fallback", async () => {
		const computer = createComputer();
		const performAction = vi.spyOn(computer, "performAction").mockResolvedValue(undefined);
		const setTarget = vi.spyOn(computer, "setTarget");
		const scroll = vi.spyOn(computer, "scroll").mockResolvedValue(undefined);
		const tool = createScrollTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", direction: "down", element_index: "7", pages: 3 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(performAction).toHaveBeenCalledTimes(3);
		expect(performAction).toHaveBeenNthCalledWith(1, 1234, 7, "AXScrollDownByPage");
		expect(performAction).toHaveBeenNthCalledWith(2, 1234, 7, "AXScrollDownByPage");
		expect(performAction).toHaveBeenNthCalledWith(3, 1234, 7, "AXScrollDownByPage");
		expect(setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(scroll).toHaveBeenCalledWith({ direction: "down", amount: 30 });
	});

	it("throws when element_index is missing instead of taking over the cursor", async () => {
		const computer = createComputer();
		const tool = createScrollTool(computer);

		await expect(
			tool.execute(
				"tool-call",
				{ app: "Finder", direction: "down", pages: 1 },
				undefined,
				undefined,
				{} as ExtensionContext,
			),
		).rejects.toThrow(/element_index/);
	});
});
