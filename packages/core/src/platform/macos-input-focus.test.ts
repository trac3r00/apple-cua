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

describe("#given focused app targeted input", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		windowMock.openWindows.mockResolvedValue([]);
	});

	it("#when a focused app has multiple visible windows #then pointer routing uses the window containing the click", async () => {
		// given
		windowMock.openWindows.mockResolvedValue([
			{
				id: 10,
				owner: { processId: 1234 },
				bounds: { x: 0, y: 0, width: 200, height: 160 },
			},
			{
				id: 20,
				owner: { processId: 1234 },
				bounds: { x: 400, y: 300, width: 300, height: 220 },
			},
			{
				id: 30,
				owner: { processId: 9876 },
				bounds: { x: 400, y: 300, width: 300, height: 220 },
			},
		]);
		const { MacOSInputController } = await import("./macos-input.js");
		const controller = new MacOSInputController(1234);

		// when
		await controller.click({ x: 450, y: 340 });

		// then
		const targetWindow = { id: 20, bounds: { x: 400, y: 300, width: 300, height: 220 } };
		expect(skyLightMock.activateWindowWithoutRaise).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "down",
			position: { x: 450, y: 340 },
			button: "left",
			clickState: 1,
			targetPid: 1234,
			targetWindow,
		});
		controller.close();
	});

	it("#when no target window contains the click #then pointer routing falls back to the first visible target window", async () => {
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
		await controller.click({ x: 900, y: 900 });

		// then
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "down",
			position: { x: 900, y: 900 },
			button: "left",
			clickState: 1,
			targetPid: 1234,
			targetWindow: { id: 99, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		});
		controller.close();
	});

	it("#when double-clicking a target pid #then it does not activate the app", async () => {
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
		await controller.doubleClick({ x: 50, y: 70 });

		// then
		expect(skyLightMock.activateWindowWithoutRaise).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledTimes(4);
		controller.close();
	});

	it("#when dragging in a target pid #then it does not activate the app", async () => {
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
		await controller.drag({ from: { x: 50, y: 70 }, to: { x: 90, y: 110 }, duration: 0 });

		// then
		expect(skyLightMock.activateWindowWithoutRaise).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith({
			kind: "drag",
			position: { x: 90, y: 110 },
			button: "left",
			clickState: 1,
			targetPid: 1234,
			targetWindow: { id: 99, bounds: { x: 10, y: 20, width: 300, height: 200 } },
		});
		controller.close();
	});
});
