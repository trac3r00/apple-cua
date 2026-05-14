import { beforeEach, describe, expect, it, vi } from "vitest";

const helperMock = vi.hoisted(() => {
	const instance = {
		clickPid: vi.fn(() => Promise.resolve()),
		rightClickPid: vi.fn(() => Promise.resolve()),
		middleClickPid: vi.fn(() => Promise.resolve()),
		doubleClickPid: vi.fn(() => Promise.resolve()),
		movePid: vi.fn(() => Promise.resolve()),
		dragPid: vi.fn(() => Promise.resolve()),
		keyPid: vi.fn(() => Promise.resolve()),
		typeTextPid: vi.fn(() => Promise.resolve()),
		close: vi.fn(),
	};
	return {
		instance,
		constructor: vi.fn(() => instance),
	};
});

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 1, y: 2 })),
	postKeyboardEvent: vi.fn(),
	postMouseEvent: vi.fn(),
	postScrollEvent: vi.fn(),
	postUnicodeText: vi.fn(),
}));

vi.mock("./macos-helper.js", () => ({ MacOSCuaHelper: helperMock.constructor }));
vi.mock("./macos-ffi/coregraphics.js", () => ({
	K_CG_EVENT_FLAG_MASK_ALTERNATE: 0x00080000,
	K_CG_EVENT_FLAG_MASK_COMMAND: 0x00100000,
	K_CG_EVENT_FLAG_MASK_CONTROL: 0x00040000,
	K_CG_EVENT_FLAG_MASK_SHIFT: 0x00020000,
	getCurrentCursorPosition: coreGraphicsMock.getCurrentCursorPosition,
	postKeyboardEvent: coreGraphicsMock.postKeyboardEvent,
	postMouseEvent: coreGraphicsMock.postMouseEvent,
	postScrollEvent: coreGraphicsMock.postScrollEvent,
	postUnicodeText: coreGraphicsMock.postUnicodeText,
}));

describe("#given MacOSInputController target routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("#when clicking with a target pid #then routes to the helper and avoids CoreGraphics global mouse events", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(1234);

		// when
		await controller.click({ x: 500, y: 300 });

		// then
		expect(helperMock.instance.clickPid).toHaveBeenCalledWith(1234, { x: 500, y: 300 });
		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when clicking without a target pid #then keeps the existing CoreGraphics global path", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController();

		// when
		await controller.click({ x: 10, y: 20 }, "right");

		// then
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "move",
			position: { x: 10, y: 20 },
			button: "left",
			clickState: undefined,
			targetPid: undefined,
		});
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "down",
			position: { x: 10, y: 20 },
			button: "right",
			clickState: 1,
			targetPid: undefined,
		});
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "up",
			position: { x: 10, y: 20 },
			button: "right",
			clickState: 1,
			targetPid: undefined,
		});
		expect(helperMock.instance.rightClickPid).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when scrolling with a target pid #then maps vertical scroll to helper keyboard events", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(4321);

		// when
		await controller.scroll({ direction: "down", amount: 2 });

		// then
		expect(helperMock.instance.keyPid).toHaveBeenNthCalledWith(1, 4321, "pagedown", { modifiers: [] });
		expect(helperMock.instance.keyPid).toHaveBeenNthCalledWith(2, 4321, "pagedown", { modifiers: [] });
		expect(coreGraphicsMock.postScrollEvent).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when typing and pressing keys with a target pid #then routes unicode text and key chords through helper", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(9876);

		// when
		await controller.typeText("Hello");
		await controller.pressKey("l", { modifiers: ["command"] });

		// then
		expect(helperMock.instance.typeTextPid).toHaveBeenCalledWith(9876, "Hello");
		expect(helperMock.instance.keyPid).toHaveBeenCalledWith(9876, "l", { modifiers: ["command"] });
		expect(coreGraphicsMock.postUnicodeText).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postKeyboardEvent).not.toHaveBeenCalled();
		controller.close();
	});
});
