import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { AppObservationKeys } from "./observations.js";
import { createSetValueTool } from "./set-value.js";

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
		getAppState: vi.fn<ComputerInterface["getAppState"]>().mockResolvedValue({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [],
			screenshotBase64: "",
			screenshotWidth: 2560,
			screenshotHeight: 1600,
			display: { width: 2560, height: 1600, scaleFactor: 2 },
			contentKind: "ax",
			axChangeSummary: { added: 0, removed: 0, changed: 1 },
			axChanges: {
				added: [],
				removed: [],
				changed: [
					{
						before: {
							id: 9,
							role: "AXTextField",
							label: "Name",
							value: "old",
							frame: { x: 0, y: 0, width: 10, height: 10 },
							actions: [],
							children: [],
						},
						after: {
							id: 9,
							role: "AXTextField",
							label: "Name",
							value: "abc",
							frame: { x: 0, y: 0, width: 10, height: 10 },
							actions: [],
							children: [],
						},
					},
				],
			},
		}),
		getScreenshotViewport: vi.fn<ComputerInterface["getScreenshotViewport"]>().mockResolvedValue(undefined),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>(),
		selectText: vi.fn<ComputerInterface["selectText"]>(),
		performAction: vi.fn<ComputerInterface["performAction"]>(),
		pressAtPosition: vi.fn<ComputerInterface["pressAtPosition"]>(),
		typeIntoFocused: vi.fn<ComputerInterface["typeIntoFocused"]>(),
		assertObservationCurrent: vi.fn<ComputerInterface["assertObservationCurrent"]>(),
		close: vi.fn<ComputerInterface["close"]>(),
	};
}

describe("#given set_value tool #when executed #then it returns post-action observation, not just prose", () => {
	it("includes the post-action axChangeSummary and axChanges in the result", async () => {
		const computer = createComputer();
		const tool = createSetValueTool(computer, testObservations());

		const result = await tool.execute(
			"tool-call",
			{ app: "Finder", element_index: "9", value: "abc" },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		const text = result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");
		expect(text).toContain("axChangeSummary 0/0/1");
		expect(text).toContain('"axChanges"');
		expect(computer.setValue).toHaveBeenCalledWith(1234, 9, "abc");
		expect(computer.getAppState).toHaveBeenCalledWith(1234);
	});
});

function testObservations(): AppObservationKeys {
	const observations = new AppObservationKeys();
	observations.record(1234, "0:test");
	return observations;
}
