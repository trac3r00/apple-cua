import { beforeEach, describe, expect, it, vi } from "vitest";

interface TestWindow {
	readonly id: number;
	readonly owner: {
		readonly processId: number;
	};
	readonly bounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
}

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 1, y: 2 })),
	postKeyboardEvent: vi.fn(),
	postMouseEvent: vi.fn(),
	postScrollEvent: vi.fn(),
	postUnicodeText: vi.fn(),
}));

const windowMock = vi.hoisted(() => ({
	openWindows: vi.fn<() => Promise<readonly TestWindow[]>>(() => Promise.resolve([])),
}));

const skyLightMock = vi.hoisted(() => ({
	activateWindowWithoutRaise: vi.fn(() => true),
}));

vi.mock("get-windows", () => ({ openWindows: windowMock.openWindows }));
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
vi.mock("./macos-ffi/skylight.js", () => ({
	activateWindowWithoutRaise: skyLightMock.activateWindowWithoutRaise,
}));
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
		windowMock.openWindows.mockResolvedValue([]);
	});

	it("#when clicking with a target pid and no visible window #then refuses unsafe public pid fallback", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(1234);

		// when/then
		await expect(controller.click({ x: 500, y: 300 })).rejects.toThrow(
			"targeted pointer input requires get_app_state or a visible target window",
		);

		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when clicking a target pid with a known window #then routes through that window without activating the app", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{
				id: 99,
				owner: { processId: 1234 },
				bounds: { x: 10, y: 20, width: 300, height: 200 },
			},
		]);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(1234);

		// when
		await controller.click({ x: 50, y: 70 });
		await controller.pressKey("t");

		// then
		expect(skyLightMock.activateWindowWithoutRaise).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "down",
			position: { x: 50, y: 70 },
			button: "left",
			clickState: 1,
			targetPid: 1234,
			targetWindow: { id: 99, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		});
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenCalledWith({
			keyCode: 17,
			keyDown: true,
			flags: 0,
			text: undefined,
			targetPid: 1234,
			targetWindow: { id: 99, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		});
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
		controller.close();
	});

	it("#when scrolling with a target pid and no remembered window #then refuses unsafe public pid fallback", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(4321);

		// when/then
		await expect(controller.scroll({ direction: "down", amount: 2 })).rejects.toThrow(
			"targeted scroll input requires get_app_state, a visible target window, or a prior pointer action",
		);

		expect(coreGraphicsMock.postScrollEvent).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when get_app_state has remembered a target window #then keyboard and scroll reuse that app session", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{
				id: 77,
				owner: { processId: 9876 },
				bounds: { x: 100, y: 200, width: 300, height: 240 },
			},
		]);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(9876);

		// when
		await controller.rememberTargetWindow(9876);
		await controller.typeText("Hello");
		await controller.pressKey("l", { modifiers: ["command"] });
		await controller.scroll({ direction: "down", amount: 2 });

		// then
		const targetWindow = { id: 77, bounds: { x: 100, y: 200, width: 300, height: 240 } };
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenCalledTimes(5);
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenNthCalledWith(1, "H", 9876, targetWindow);
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenNthCalledWith(5, "o", 9876, targetWindow);
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(1, {
			keyCode: 37,
			keyDown: true,
			flags: 0x00100000,
			text: undefined,
			targetPid: 9876,
			targetWindow,
		});
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(2, {
			keyCode: 37,
			keyDown: false,
			flags: 0x00100000,
			text: undefined,
			targetPid: 9876,
			targetWindow,
		});
		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledWith({
			deltaX: 0,
			deltaY: -2,
			targetPid: 9876,
			targetWindow,
		});
		controller.close();
	});

	it("#when a target pid has a visible window #then keyboard input lazily primes that app session", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{
				id: 88,
				owner: { processId: 9876 },
				bounds: { x: 20, y: 40, width: 300, height: 240 },
			},
		]);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(9876);

		// when
		await controller.pressKey("l", { modifiers: ["command"] });

		// then
		const targetWindow = { id: 88, bounds: { x: 20, y: 40, width: 300, height: 240 } };
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenNthCalledWith(1, {
			keyCode: 37,
			keyDown: true,
			flags: 0x00100000,
			text: undefined,
			targetPid: 9876,
			targetWindow,
		});
		controller.close();
	});

	it("#when typing with a target pid and no remembered window #then refuses unsafe public pid fallback", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(9876);

		// when/then
		await expect(controller.typeText("Hello")).rejects.toThrow(
			"targeted keyboard input requires get_app_state, a visible target window, or a prior pointer action",
		);
		expect(coreGraphicsMock.postUnicodeText).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when clicking #then the virtual pointer overlay tracks the click and getCursorPosition reports it", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{ id: 99, owner: { processId: 1234 }, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		]);
		const overlay = { set: vi.fn(), highlight: vi.fn(), hide: vi.fn(), close: vi.fn() };
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(1234, overlay);

		// when
		await controller.click({ x: 50, y: 70 });

		// then
		expect(overlay.set).toHaveBeenCalledWith({ x: 50, y: 70 });
		expect(controller.getCursorPosition()).toEqual({ x: 50, y: 70 });
		controller.close();
		expect(overlay.close).toHaveBeenCalledOnce();
	});

	it("#when an action runs #then it holds a display-sleep assertion and releases it on close", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{ id: 99, owner: { processId: 1234 }, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		]);
		const displaySleep = { acquire: vi.fn(), release: vi.fn() };
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(
			1234,
			{ set: vi.fn(), highlight: vi.fn(), hide: vi.fn(), close: vi.fn() },
			() => false,
			displaySleep,
		);

		// when
		await controller.click({ x: 50, y: 70 });
		controller.close();

		// then
		expect(displaySleep.acquire).toHaveBeenCalled();
		expect(displaySleep.release).toHaveBeenCalledOnce();
	});

	it("#when the screen is locked #then input is refused and no event is posted", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{ id: 99, owner: { processId: 1234 }, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		]);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(
			1234,
			{ set: vi.fn(), highlight: vi.fn(), hide: vi.fn(), close: vi.fn() },
			() => true,
		);

		// when/then
		await expect(controller.click({ x: 50, y: 70 })).rejects.toThrow(/Mac is locked/);
		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when no action has happened #then getCursorPosition seeds from the real cursor", async () => {
		// given
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(1234, {
			set: vi.fn(),
			highlight: vi.fn(),
			hide: vi.fn(),
			close: vi.fn(),
		});

		// when/then
		expect(controller.getCursorPosition()).toEqual({ x: 1, y: 2 });
		controller.close();
	});
});
