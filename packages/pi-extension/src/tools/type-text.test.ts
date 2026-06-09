import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createTypeTextTool } from "./type-text.js";

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
		type: vi.fn<ComputerInterface["type"]>().mockResolvedValue(undefined),
		key: vi.fn<ComputerInterface["key"]>(),
		scroll: vi.fn<ComputerInterface["scroll"]>(),
		drag: vi.fn<ComputerInterface["drag"]>(),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>(),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>(),
		getAppState: vi.fn<ComputerInterface["getAppState"]>(),
		getScreenshotViewport: vi.fn<ComputerInterface["getScreenshotViewport"]>().mockResolvedValue(undefined),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "TextEdit", bundleId: "com.apple.TextEdit", pid: 9001, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
		pressAtPosition: vi.fn<ComputerInterface["pressAtPosition"]>(),
		typeIntoFocused: vi.fn<ComputerInterface["typeIntoFocused"]>(),
		close: vi.fn<ComputerInterface["close"]>(),
	};
}

describe("#given type_text tool #when AX focused element accepts the write #then no synthetic keystrokes fire", () => {
	it("uses typeIntoFocused and skips computer.type when AX path succeeds", async () => {
		// given
		const computer = createComputer();
		vi.spyOn(computer, "typeIntoFocused").mockResolvedValue(true);
		const tool = createTypeTextTool(computer);

		// when
		await tool.execute(
			"tool-call",
			{ app: "TextEdit", text: "macos-cua" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		// then
		expect(computer.typeIntoFocused).toHaveBeenCalledWith(9001, "macos-cua");
		expect(computer.type).not.toHaveBeenCalled();
		expect(computer.setTarget).not.toHaveBeenCalled();
	});
});

describe("#given type_text tool #when AX focused write fails #then it falls back to synthetic typing in the targeted app", () => {
	it("invokes computer.type within the targeted app when typeIntoFocused returns false", async () => {
		// given
		const computer = createComputer();
		vi.spyOn(computer, "typeIntoFocused").mockResolvedValue(false);
		const tool = createTypeTextTool(computer);

		// when
		await tool.execute(
			"tool-call",
			{ app: "TextEdit", text: "fallback" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		// then
		expect(computer.typeIntoFocused).toHaveBeenCalledWith(9001, "fallback");
		expect(computer.setTarget).toHaveBeenNthCalledWith(1, 9001);
		expect(computer.type).toHaveBeenCalledWith("fallback");
		expect(computer.setTarget).toHaveBeenLastCalledWith(undefined);
	});
});
