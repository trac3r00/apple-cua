import { describe, expect, it, vi } from "vitest";

import type { ComputerInterface } from "./interface.js";
import { pressKeySequence } from "./key-sequence.js";

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
		listApps: vi.fn<ComputerInterface["listApps"]>(),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		selectText: vi.fn<ComputerInterface["selectText"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
		pressAtPosition: vi.fn<ComputerInterface["pressAtPosition"]>(),
		typeIntoFocused: vi.fn<ComputerInterface["typeIntoFocused"]>(),
		close: vi.fn<ComputerInterface["close"]>(),
	};
}

describe("#given key sequence input #when pressing keys #then it applies interval and hold timings", () => {
	it("presses chords in order with default and per-key hold durations", async () => {
		// given
		vi.useFakeTimers();
		const computer = createComputer();
		const observedTimes: number[] = [];
		vi.mocked(computer.key).mockImplementation(async () => {
			observedTimes.push(Date.now());
		});

		// when
		const pressing = pressKeySequence(computer, [{ key: "super+k" }, { key: "Return", holdSeconds: 0.25 }], {
			holdSeconds: 0.1,
			intervalSeconds: 0.5,
		});
		await vi.runAllTimersAsync();
		await pressing;

		// then
		expect(computer.key).toHaveBeenNthCalledWith(1, "k", { modifiers: ["command"], holdMilliseconds: 100 });
		expect(computer.key).toHaveBeenNthCalledWith(2, "Return", { holdMilliseconds: 250 });
		expect(observedTimes).toHaveLength(2);
		const firstObservedTime = observedTimes[0];
		const secondObservedTime = observedTimes[1];
		if (firstObservedTime === undefined || secondObservedTime === undefined) {
			throw new Error("expected two observed key press times");
		}
		expect(secondObservedTime - firstObservedTime).toBe(500);
		expect(vi.getTimerCount()).toBe(0);
		vi.useRealTimers();
	});

	it("rejects an empty key list", async () => {
		// given
		const computer = createComputer();

		await expect(pressKeySequence(computer, [])).rejects.toThrow("press_keys requires at least one key");
		expect(computer.key).not.toHaveBeenCalled();
	});
});
