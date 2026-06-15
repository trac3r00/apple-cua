import { beforeEach, describe, expect, it, vi } from "vitest";

interface TestWindow {
	readonly id: number;
	readonly owner: {
		readonly processId: number;
	} | null;
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

const fallbackMock = vi.hoisted(() => ({
	selectSystemEventsTargetWindow: vi.fn(),
}));

vi.mock("get-windows", () => ({ openWindows: windowMock.openWindows }));
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
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
vi.mock("./macos-window-target-fallback.js", () => ({
	selectSystemEventsTargetWindow: fallbackMock.selectSystemEventsTargetWindow,
}));

describe("#given target windows without owner metadata", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		windowMock.openWindows.mockResolvedValue([]);
		fallbackMock.selectSystemEventsTargetWindow.mockResolvedValue(undefined);
	});

	it("#when typing to a target pid #then uses the System Events matched window for keyboard routing", async () => {
		const ownerlessWindow = { id: 55, owner: null, bounds: { x: 150, y: 70, width: 580, height: 480 } };
		const targetWindow = { id: 55, bounds: ownerlessWindow.bounds };
		windowMock.openWindows.mockResolvedValue([ownerlessWindow]);
		fallbackMock.selectSystemEventsTargetWindow.mockResolvedValue(targetWindow);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(17264);

		await controller.typeText("Q");

		expect(fallbackMock.selectSystemEventsTargetWindow).toHaveBeenCalledWith([ownerlessWindow], 17264, undefined);
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenCalledWith("Q", 17264, targetWindow);
		controller.close();
	});

	it("#when get-windows fails transiently #then retries before routing keyboard input", async () => {
		const targetWindow = { id: 77, owner: { processId: 17264 }, bounds: { x: 10, y: 20, width: 300, height: 240 } };
		windowMock.openWindows.mockRejectedValueOnce(new Error("get-windows failed"));
		windowMock.openWindows.mockResolvedValueOnce([targetWindow]);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(17264);

		await controller.typeText("R");

		expect(windowMock.openWindows).toHaveBeenCalledTimes(2);
		expect(coreGraphicsMock.postUnicodeText).toHaveBeenCalledWith("R", 17264, {
			id: 77,
			bounds: targetWindow.bounds,
		});
		controller.close();
	});

	it("#when scrolling to an ownerless target pid #then uses the System Events matched window for wheel routing", async () => {
		const ownerlessWindow = { id: 88, owner: null, bounds: { x: 120, y: 80, width: 620, height: 500 } };
		const targetWindow = { id: 88, bounds: ownerlessWindow.bounds };
		windowMock.openWindows.mockResolvedValue([ownerlessWindow]);
		fallbackMock.selectSystemEventsTargetWindow.mockResolvedValue(targetWindow);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(17264);

		await controller.scroll({ direction: "down", amount: 3 });

		expect(fallbackMock.selectSystemEventsTargetWindow).toHaveBeenCalledWith([ownerlessWindow], 17264, undefined);
		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledWith({
			deltaX: 0,
			deltaY: -3,
			targetPid: 17264,
			targetWindow,
		});
		controller.close();
	});
});
