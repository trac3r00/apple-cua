import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createPressKeysTool } from "./press-key.js";

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
		key: vi.fn<ComputerInterface["key"]>().mockResolvedValue(undefined),
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

describe("#given press_keys tool #when executed #then it presses a timed key sequence", () => {
	it("sets the target app, presses keys in order, and restores the target", async () => {
		// given
		vi.useFakeTimers();
		const computer = createComputer();
		const tool = createPressKeysTool(computer);

		// when
		const execution = tool.execute(
			"tool-call",
			{
				app: "Finder",
				keys: ["super+k", { key: "Return", hold_seconds: 0.25 }],
				hold_seconds: 0.1,
				interval_seconds: 0.5,
			},
			undefined,
			undefined,
			{} as ExtensionContext,
		);
		await vi.runAllTimersAsync();
		await execution;

		// then
		expect(computer.setTarget).toHaveBeenNthCalledWith(1, 1234);
		expect(computer.key).toHaveBeenNthCalledWith(1, "k", { modifiers: ["command"], holdMilliseconds: 100 });
		expect(computer.key).toHaveBeenNthCalledWith(2, "Return", { holdMilliseconds: 250 });
		expect(computer.setTarget).toHaveBeenLastCalledWith(undefined);
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});
});
