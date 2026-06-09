import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createDragTool } from "./drag.js";

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
		drag: vi.fn<ComputerInterface["drag"]>().mockResolvedValue(undefined),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>(),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>(),
		getAppState: vi.fn<ComputerInterface["getAppState"]>(),
		getScreenshotViewport: vi.fn<ComputerInterface["getScreenshotViewport"]>().mockResolvedValue({
			windowBounds: { x: 0, y: 0, width: 100, height: 80 },
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
		pressAtPosition: vi.fn<ComputerInterface["pressAtPosition"]>(),
		typeIntoFocused: vi.fn<ComputerInterface["typeIntoFocused"]>(),
		close: vi.fn<ComputerInterface["close"]>(),
	};
}

describe("#given drag tool factory #when built #then tool name is Codex-compatible", () => {
	it("returns drag", () => {
		const computer = createComputer();
		const tool = createDragTool(computer);

		expect(tool.name).toBe("drag");
	});
});

describe("#given drag tool #when executed #then computer drag receives endpoints", () => {
	it("drags from start to end", async () => {
		const computer = createComputer();
		const tool = createDragTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", from_x: 1, from_y: 2, to_x: 3, to_y: 4 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(computer.drag).toHaveBeenCalledWith({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
		expect(computer.setTarget).toHaveBeenLastCalledWith(undefined);
	});

	it("maps both endpoints from screenshot pixels onto the window's screen position", async () => {
		const computer = createComputer();
		vi.spyOn(computer, "getScreenshotViewport").mockResolvedValue({
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		});
		const tool = createDragTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", from_x: 0, from_y: 0, to_x: 250, to_y: 200 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.drag).toHaveBeenCalledWith({ from: { x: 300, y: 150 }, to: { x: 800, y: 550 } });
	});

	it("passes both endpoints through unchanged when no screenshot viewport is known", async () => {
		const computer = createComputer();
		vi.spyOn(computer, "getScreenshotViewport").mockResolvedValue(undefined);
		const tool = createDragTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", from_x: 11, from_y: 22, to_x: 33, to_y: 44 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.drag).toHaveBeenCalledWith({ from: { x: 11, y: 22 }, to: { x: 33, y: 44 } });
	});
});
