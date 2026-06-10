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
			screenshotMimeType: "image/jpeg",
			display: { width: 100, height: 80, scaleFactor: 1 },
		}),
		getScreenshotViewport: vi
			.fn<ComputerInterface["getScreenshotViewport"]>()
			// Identity viewport: a 100x80 screenshot of a window at the screen origin.
			.mockResolvedValue({
				windowBounds: { x: 0, y: 0, width: 100, height: 80 },
				screenshotWidth: 100,
				screenshotHeight: 80,
			}),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		selectText: vi.fn<ComputerInterface["selectText"]>().mockResolvedValue(undefined),
		performAction: vi.fn<ComputerInterface["performAction"]>().mockResolvedValue(undefined),
		pressAtPosition: vi.fn<ComputerInterface["pressAtPosition"]>().mockResolvedValue(false),
		typeIntoFocused: vi.fn<ComputerInterface["typeIntoFocused"]>().mockResolvedValue(false),
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
	it("falls back to the synthetic mouse only when AX hit-test cannot press the element", async () => {
		const computer = createComputer();
		const pressAtPosition = vi.spyOn(computer, "pressAtPosition").mockResolvedValue(false);
		const tool = createClickTool(computer);

		await tool.execute("tool-call", { app: "Finder", x: 10, y: 20 }, undefined, undefined, {} as ExtensionContext);

		expect(pressAtPosition).toHaveBeenCalledWith(1234, { x: 10, y: 20 });
		expect(computer.setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(computer.click).toHaveBeenCalledWith({ x: 10, y: 20 });
		expect(computer.setTarget).toHaveBeenLastCalledWith(undefined);
	});

	it("presses the element under the cursor via AX without moving the mouse when AX accepts", async () => {
		const computer = createComputer();
		const pressAtPosition = vi.spyOn(computer, "pressAtPosition").mockResolvedValue(true);
		const tool = createClickTool(computer);

		await tool.execute("tool-call", { app: "Finder", x: 10, y: 20 }, undefined, undefined, {} as ExtensionContext);

		expect(pressAtPosition).toHaveBeenCalledWith(1234, { x: 10, y: 20 });
		expect(computer.click).not.toHaveBeenCalled();
		expect(computer.setTarget).not.toHaveBeenCalled();
	});

	it("presses the accessibility element via AXPress instead of moving the cursor", async () => {
		const computer = createComputer();
		const tool = createClickTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", element_index: "5" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.performAction).toHaveBeenCalledWith(1234, 5, "AXPress");
		expect(computer.click).not.toHaveBeenCalled();
		expect(computer.setTarget).not.toHaveBeenCalled();
	});

	it("maps screenshot pixel coordinates onto the window's screen position before dispatch", async () => {
		const computer = createComputer();
		vi.spyOn(computer, "getScreenshotViewport").mockResolvedValue({
			windowBounds: { x: 300, y: 150, width: 1000, height: 800 },
			screenshotWidth: 500,
			screenshotHeight: 400,
		});
		const getScreenshotViewport = vi.spyOn(computer, "getScreenshotViewport");
		const pressAtPosition = vi.spyOn(computer, "pressAtPosition").mockResolvedValue(false);
		const tool = createClickTool(computer);

		await tool.execute("tool-call", { app: "Finder", x: 250, y: 200 }, undefined, undefined, {} as ExtensionContext);

		expect(getScreenshotViewport).toHaveBeenCalledWith(1234);
		expect(pressAtPosition).toHaveBeenCalledWith(1234, { x: 800, y: 550 });
		expect(computer.click).toHaveBeenCalledWith({ x: 800, y: 550 });
	});

	it("passes raw coordinates through every dispatch path when no screenshot viewport is known", async () => {
		const computer = createComputer();
		vi.spyOn(computer, "getScreenshotViewport").mockResolvedValue(undefined);
		const pressAtPosition = vi.spyOn(computer, "pressAtPosition").mockResolvedValue(false);
		const tool = createClickTool(computer);

		await tool.execute("tool-call", { app: "Finder", x: 42, y: 17 }, undefined, undefined, {} as ExtensionContext);

		expect(pressAtPosition).toHaveBeenCalledWith(1234, { x: 42, y: 17 });
		expect(computer.click).toHaveBeenCalledWith({ x: 42, y: 17 });
	});

	it("reports the virtual pointer position before and after the click", async () => {
		const computer = createComputer();
		vi.spyOn(computer, "getCursorPosition")
			.mockResolvedValueOnce({ x: 11, y: 22 })
			.mockResolvedValueOnce({ x: 33, y: 44 });
		const tool = createClickTool(computer);

		const result = await tool.execute(
			"tool-call",
			{ app: "Finder", element_index: "5" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(result.details).toEqual({ cursorBefore: { x: 11, y: 22 }, cursorAfter: { x: 33, y: 44 } });
	});

	it("presses the AX element click_count times for repeated activations", async () => {
		const computer = createComputer();
		const tool = createClickTool(computer);

		await tool.execute(
			"tool-call",
			{ app: "Finder", element_index: "5", click_count: 3 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.performAction).toHaveBeenCalledTimes(3);
		expect(computer.performAction).toHaveBeenNthCalledWith(1, 1234, 5, "AXPress");
		expect(computer.performAction).toHaveBeenNthCalledWith(2, 1234, 5, "AXPress");
		expect(computer.performAction).toHaveBeenNthCalledWith(3, 1234, 5, "AXPress");
	});
});
