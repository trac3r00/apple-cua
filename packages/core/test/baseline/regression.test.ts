import { beforeEach, describe, expect, it, vi } from "vitest";

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 1, y: 2 })),
	postKeyboardEvent: vi.fn(),
	postMouseEvent: vi.fn(),
	postScrollEvent: vi.fn(),
	postUnicodeText: vi.fn(),
}));

const windowMock = vi.hoisted(() => ({
	openWindows: vi.fn(() => Promise.resolve([])),
}));

const skyLightMock = vi.hoisted(() => ({
	activateWindowWithoutRaise: vi.fn(() => true),
}));

vi.mock("get-windows", () => ({ openWindows: windowMock.openWindows }));
vi.mock("../../src/platform/macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
vi.mock("../../src/platform/macos-ffi/skylight.js", () => ({
	activateWindowWithoutRaise: skyLightMock.activateWindowWithoutRaise,
}));
vi.mock("../../src/platform/macos-ffi/coregraphics.js", () => ({
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

describe("#given baseline CGEvent regression suite #when MacOSInputController dispatches without target pid #then CoreGraphics path is exercised", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		windowMock.openWindows.mockResolvedValue([]);
	});

	it("click dispatches move + down + up via postMouseEvent", async () => {
		const { MacOSInputController } = await import("../../src/platform/macos-input.js");
		const controller = new MacOSInputController();

		await controller.click({ x: 100, y: 200 });

		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "move",
			position: { x: 100, y: 200 },
			button: "left",
			clickState: undefined,
			targetPid: undefined,
		});
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "down",
			position: { x: 100, y: 200 },
			button: "left",
			clickState: 1,
			targetPid: undefined,
		});
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "up",
			position: { x: 100, y: 200 },
			button: "left",
			clickState: 1,
			targetPid: undefined,
		});
		controller.close();
	});

	it("type dispatches each character via postUnicodeText", async () => {
		const { MacOSInputController } = await import("../../src/platform/macos-input.js");
		const controller = new MacOSInputController();

		await controller.typeText("안녕하세요");

		expect(coreGraphicsMock.postUnicodeText).toHaveBeenCalledTimes(5);
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenNthCalledWith(1, "안", undefined, undefined);
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenNthCalledWith(5, "요", undefined, undefined);
		controller.close();
	});

	it("key with modifiers dispatches via postKeyboardEvent with flags", async () => {
		const { MacOSInputController } = await import("../../src/platform/macos-input.js");
		const controller = new MacOSInputController();

		await controller.pressKey("c", { modifiers: ["command"] });

		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenCalledTimes(2);
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(1, {
			keyCode: 8,
			keyDown: true,
			flags: 0x00100000,
			text: undefined,
			targetPid: undefined,
		});
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(2, {
			keyCode: 8,
			keyDown: false,
			flags: 0x00100000,
			text: undefined,
			targetPid: undefined,
		});
		controller.close();
	});

	it("scroll dispatches via postScrollEvent", async () => {
		const { MacOSInputController } = await import("../../src/platform/macos-input.js");
		const controller = new MacOSInputController();

		await controller.scroll({ direction: "down", amount: 3 });

		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledTimes(1);
		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledWith({
			deltaX: 0,
			deltaY: -3,
			targetPid: undefined,
		});
		controller.close();
	});
});
