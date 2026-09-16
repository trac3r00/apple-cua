import { describe, expect, it, vi } from "vitest";

import type { AppState } from "../accessibility/types.js";
import { observeAction } from "./actions.js";
import type { ComputerInterface } from "./interface.js";

function fakeAppState(label: string): AppState {
	return {
		app: "Finder",
		bundleId: "com.apple.finder",
		pid: 1234,
		frontmost: true,
		axAvailable: true,
		elements: [
			{
				id: 1,
				role: "AXButton",
				label,
				value: null,
				frame: { x: 0, y: 0, width: 10, height: 10 },
				actions: ["AXPress"],
				children: [],
			},
		],
		screenshotBase64: "",
		screenshotWidth: 2560,
		screenshotHeight: 1600,
		display: { width: 2560, height: 1600, scaleFactor: 2 },
	};
}

function fakeComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn(),
		setTarget: vi.fn(),
		move: vi.fn(),
		click: vi.fn(),
		rightClick: vi.fn(),
		middleClick: vi.fn(),
		doubleClick: vi.fn(),
		type: vi.fn(),
		key: vi.fn(),
		scroll: vi.fn(),
		drag: vi.fn(),
		getCursorPosition: vi.fn(),
		getScreenSize: vi.fn(),
		getAppState: vi.fn<ComputerInterface["getAppState"]>().mockResolvedValue(fakeAppState("After")),
		getScreenshotViewport: vi.fn(),
		listApps: vi.fn(),
		setValue: vi.fn(),
		selectText: vi.fn(),
		performAction: vi.fn(),
		pressAtPosition: vi.fn(),
		typeIntoFocused: vi.fn(),
		assertObservationCurrent: vi.fn(),
		close: vi.fn(),
	};
}

describe("#given an action #when observed #then it runs the action and returns the fresh app state", () => {
	it("executes the action before reading state", async () => {
		const computer = fakeComputer();
		const order: string[] = [];
		const action = vi.fn(async () => {
			order.push("action");
		});
		(computer.getAppState as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			order.push("observe");
			return fakeAppState("After");
		});

		const state = await observeAction(computer, 1234, action);

		expect(action).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["action", "observe"]);
		expect(state.elements[0]?.label).toBe("After");
	});

	it("propagates the post-action state so the model can verify without a separate call", async () => {
		const computer = fakeComputer();

		const state = await observeAction(computer, 1234, async () => {});

		expect(computer.getAppState).toHaveBeenCalledWith(1234);
		expect(state.pid).toBe(1234);
	});
});
