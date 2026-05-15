import { beforeEach, describe, expect, it, vi } from "vitest";

const accessibilityMock = vi.hoisted(() => ({
	extractAccessibilityTree: vi.fn(),
	performActionByIndex: vi.fn(),
	setValueByIndex: vi.fn(),
}));

const inputControllerMock = vi.hoisted(() => {
	class MockMacOSInputController {
		readonly setTarget = vi.fn();
		readonly click = vi.fn<(position: { x: number; y: number }) => Promise<void>>().mockResolvedValue(undefined);
		readonly pressKey = vi
			.fn<
				(key: string, options?: { modifiers?: Array<"command" | "option" | "control" | "shift"> }) => Promise<void>
			>()
			.mockResolvedValue(undefined);
		readonly typeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
		readonly close = vi.fn();
	}

	const instances: MockMacOSInputController[] = [];
	return {
		instances,
		MacOSInputController: class extends MockMacOSInputController {
			constructor() {
				super();
				instances.push(this);
			}
		},
	};
});

vi.mock("./macos-ffi/accessibility.js", () => accessibilityMock);
vi.mock("./macos-input.js", () => ({
	MacOSInputController: inputControllerMock.MacOSInputController,
}));

import { MacOSHostComputer } from "./macos.js";

beforeEach(() => {
	accessibilityMock.extractAccessibilityTree.mockReset();
	accessibilityMock.performActionByIndex.mockReset();
	accessibilityMock.setValueByIndex.mockReset();
	inputControllerMock.instances.length = 0;
});

function firstInputController(): (typeof inputControllerMock.instances)[number] {
	const controller = inputControllerMock.instances[0];
	if (controller === undefined) {
		throw new Error("expected MacOSInputController instance");
	}
	return controller;
}

describe("#given MacOSHostComputer.setValue #when called #then it writes through accessibility only", () => {
	it("calls setValueByIndex with the requested value", async () => {
		// given
		const computer = new MacOSHostComputer();

		// when
		await computer.setValue(1234, 7, "updated");

		// then
		expect(accessibilityMock.setValueByIndex).toHaveBeenCalledWith(1234, 7, "updated");
	});

	it("never falls back to synthetic keyboard input that would hijack the user", async () => {
		// given
		const computer = new MacOSHostComputer();

		// when
		await computer.setValue(1234, 7, "updated");

		// then
		const input = firstInputController();
		expect(input.click).not.toHaveBeenCalled();
		expect(input.pressKey).not.toHaveBeenCalled();
		expect(input.typeText).not.toHaveBeenCalled();
		expect(input.setTarget).not.toHaveBeenCalled();
	});
});
