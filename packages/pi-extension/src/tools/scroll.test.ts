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
		scroll: vi.fn<ComputerInterface["scroll"]>().mockResolvedValue(undefined),
		drag: vi.fn<ComputerInterface["drag"]>(),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>(),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>(),
		getAppState: vi.fn<ComputerInterface["getAppState"]>(),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
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

describe("#given scroll tool #when executed #then computer scroll receives direction and amount", () => {
	it("scrolls by the requested amount", async () => {
		const computer = createComputer();
		const tool = createScrollTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", direction: "down", pages: 5 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(computer.scroll).toHaveBeenCalledWith({ direction: "down", amount: 5 });
		expect(computer.setTarget).toHaveBeenLastCalledWith(undefined);
	});
});
