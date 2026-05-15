import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createClickTool } from "./click.js";

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
		click: vi.fn<ComputerInterface["click"]>().mockResolvedValue(undefined),
		rightClick: vi.fn<ComputerInterface["rightClick"]>().mockResolvedValue(undefined),
		middleClick: vi.fn<ComputerInterface["middleClick"]>().mockResolvedValue(undefined),
		doubleClick: vi.fn<ComputerInterface["doubleClick"]>().mockResolvedValue(undefined),
		type: vi.fn<ComputerInterface["type"]>(),
		key: vi.fn<ComputerInterface["key"]>(),
		scroll: vi.fn<ComputerInterface["scroll"]>(),
		drag: vi.fn<ComputerInterface["drag"]>(),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>(),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>(),
		getAppState: vi.fn<ComputerInterface["getAppState"]>().mockResolvedValue({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [
				{
					id: 5,
					role: "AXButton",
					label: "Open",
					value: null,
					frame: { x: 10, y: 20, width: 30, height: 40 },
					actions: ["AXPress"],
					children: [],
				},
			],
			screenshotBase64: "",
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
		close: vi.fn<ComputerInterface["close"]>(),
	};
}

describe("#given click tool factory #when built #then tool name is Codex-compatible", () => {
	it("returns click", () => {
		const computer = createComputer();
		const tool = createClickTool(computer);

		expect(tool.name).toBe("click");
	});
});

describe("#given click tool #when executed #then target app receives coordinates", () => {
	it("clicks the requested point in the resolved app", async () => {
		const computer = createComputer();
		const tool = createClickTool(computer);

		await tool.execute("tool-call", { app: "Finder", x: 10, y: 20 }, undefined, undefined, {} as ExtensionContext);

		expect(computer.setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(computer.click).toHaveBeenCalledWith({ x: 10, y: 20 });
		expect(computer.setTarget).toHaveBeenLastCalledWith(undefined);
	});

	it("clicks the center of an accessibility element index", async () => {
		const computer = createComputer();
		const tool = createClickTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", element_index: "5" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.click).toHaveBeenCalledWith({ x: 25, y: 40 });
	});
});
