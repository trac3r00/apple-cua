import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setOnscreenWindowIdsSourceForTesting } from "./macos-input.js";
import { setOpenWindowsSourceForTesting } from "./macos-open-windows.js";

const WINDOW = { id: 99, bounds: { x: 10, y: 20, width: 300, height: 200 } };
const COMMAND = 0x00100000;
const SHIFT = 0x00020000;
const OPTION = 0x00080000;

const log = vi.hoisted(() => ({ events: [] as string[] }));

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 1, y: 2 })),
	postKeyboardEvent: vi.fn<(call: KeyCall) => void>(),
	postMouseEvent: vi.fn<(call: MouseCall) => void>(),
	postScrollEvent: vi.fn(),
	postUnicodeText: vi.fn(),
	warpCursorPosition: vi.fn(),
}));

const skyLightMock = vi.hoisted(() => ({
	focusGuardFor: vi.fn(),
	setWindowAppActive: vi.fn(),
}));

vi.mock("get-windows", () => ({
	openWindows: vi.fn(() => Promise.resolve([{ id: 99, owner: { processId: 1234 }, bounds: WINDOW.bounds }])),
}));
setOpenWindowsSourceForTesting(() => undefined);
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
vi.mock("./macos-ffi/skylight.js", () => ({
	focusGuardFor: skyLightMock.focusGuardFor,
	setWindowAppActive: skyLightMock.setWindowAppActive,
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
	warpCursorPosition: coreGraphicsMock.warpCursorPosition,
}));

interface MouseCall {
	readonly kind: string;
	readonly position: { readonly x: number; readonly y: number };
	readonly flags?: number | undefined;
}
interface KeyCall {
	readonly keyCode: number;
	readonly keyDown: boolean;
	readonly flags: number;
	readonly flagsChanged?: boolean | undefined;
}

async function backgroundController() {
	const { MacOSInputController } = await import("./macos-input.js");
	return new MacOSInputController(
		1234,
		{ set: vi.fn(), highlight: vi.fn(), setMode: vi.fn(), hide: vi.fn(), close: vi.fn() },
		() => false,
		{ acquire: vi.fn(), release: vi.fn() },
		"background",
	);
}

describe("#given a background controller holding modifiers across a pointer gesture", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		log.events.length = 0;
		setOnscreenWindowIdsSourceForTesting(() => [99]);
		const { setFocusStealWatcherForTesting } = await import("./macos-input.js");
		setFocusStealWatcherForTesting(() => undefined);
		skyLightMock.focusGuardFor.mockReturnValue({ previousPsn: Buffer.alloc(8, 1), targetPsn: Buffer.alloc(8, 2) });
		skyLightMock.setWindowAppActive.mockImplementation((_window: unknown, active: boolean) => {
			log.events.push(`active:${String(active)}`);
			return true;
		});
		coreGraphicsMock.postKeyboardEvent.mockImplementation((call) => {
			log.events.push(`key:${String(call.keyCode)}:${call.keyDown ? "down" : "up"}:${call.flags.toString(16)}`);
		});
		coreGraphicsMock.postMouseEvent.mockImplementation((call) => {
			log.events.push(`mouse:${call.kind}:${call.position.x},${call.position.y}:${(call.flags ?? 0).toString(16)}`);
		});
	});

	it("#when command-clicking #then the app is activated, primed, the key goes down, the click carries the flag, and the key goes up", async () => {
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);

		expect(log.events).toEqual([
			"active:true",
			"mouse:down:-1,-1:0",
			"mouse:up:-1,-1:0",
			"key:55:down:100000",
			"mouse:down:50,70:100000",
			"mouse:up:50,70:100000",
			"key:55:up:0",
		]);
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenCalledWith(
			expect.objectContaining({ targetPid: 1234, targetWindow: WINDOW, flagsChanged: true }),
		);
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "down", flags: COMMAND, targetPid: 1234 }),
		);
		controller.close();
	});

	it("#when the click throws #then the modifier keys are still released", async () => {
		const controller = await backgroundController();
		coreGraphicsMock.postMouseEvent.mockImplementation((call) => {
			if (call.position.x === 50) {
				throw new Error("post failed");
			}
		});

		await expect(controller.click({ x: 50, y: 70 }, "left", ["command", "shift"])).rejects.toThrow("post failed");

		const keys = coreGraphicsMock.postKeyboardEvent.mock.calls.map(([call]) => [
			call.keyCode,
			call.keyDown,
			call.flags,
		]);
		expect(keys).toEqual([
			[55, true, COMMAND],
			[56, true, COMMAND | SHIFT],
			[56, false, COMMAND],
			[55, false, 0],
		]);
		controller.close();
	});

	it("#when clicking without modifiers #then no key is posted, no activation happens, and the flags are left alone", async () => {
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });

		expect(coreGraphicsMock.postKeyboardEvent).not.toHaveBeenCalled();
		expect(skyLightMock.setWindowAppActive).not.toHaveBeenCalled();
		expect(log.events).toEqual(["mouse:down:50,70:0", "mouse:up:50,70:0"]);
		expect(coreGraphicsMock.postMouseEvent.mock.calls[0]?.[0].flags).toBeUndefined();
		controller.close();
	});

	it("#when the target app is already frontmost #then it is not told anything about activation", async () => {
		const controller = await backgroundController();
		skyLightMock.focusGuardFor.mockReturnValue(null);

		await controller.click({ x: 50, y: 70 }, "left", ["shift"]);

		expect(skyLightMock.setWindowAppActive).not.toHaveBeenCalled();
		expect(log.events).toEqual([
			"key:56:down:20000",
			"mouse:down:50,70:20000",
			"mouse:up:50,70:20000",
			"key:56:up:0",
		]);
		controller.close();
	});

	it("#when dragging with a modifier #then press, every drag step and release carry the flag", async () => {
		const controller = await backgroundController();

		await controller.drag({ from: { x: 20, y: 30 }, to: { x: 60, y: 30 }, modifiers: ["alt"] });

		const mouse = coreGraphicsMock.postMouseEvent.mock.calls.map(([call]) => [call.kind, call.flags]);
		expect(mouse).toEqual([
			["down", undefined],
			["up", undefined],
			["down", OPTION],
			["drag", OPTION],
			["up", OPTION],
		]);
		controller.close();
	});

	it("#when double-clicking with a modifier #then both clicks carry the flag", async () => {
		const controller = await backgroundController();

		await controller.doubleClick({ x: 50, y: 70 }, ["shift"]);

		const flagged = coreGraphicsMock.postMouseEvent.mock.calls
			.map(([call]) => call)
			.filter((call) => call.position.x === 50);
		expect(flagged.map((call) => call.flags)).toEqual([SHIFT, SHIFT, SHIFT, SHIFT]);
		controller.close();
	});

	it("#when scrolling with a modifier at a point #then the wheel events carry the flags and the point", async () => {
		const controller = await backgroundController();
		await controller.rememberTargetWindow(1234);

		await controller.scroll({ direction: "down", amount: 4, modifiers: ["shift"], position: { x: 40, y: 60 } });

		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalledWith(
			expect.objectContaining({ flags: SHIFT, position: { x: 40, y: 60 }, targetPid: 1234 }),
		);
		expect(coreGraphicsMock.postKeyboardEvent.mock.calls.map(([call]) => call.keyDown)).toEqual([true, false]);
		controller.close();
	});

	it("#when the controller closes #then apps it told were active are told otherwise", async () => {
		const controller = await backgroundController();
		await controller.click({ x: 50, y: 70 }, "left", ["command"]);
		skyLightMock.setWindowAppActive.mockClear();

		controller.close();

		expect(skyLightMock.setWindowAppActive).toHaveBeenCalledWith(WINDOW, false);
	});

	it("#when a modifier name is unknown #then the click is refused before anything is posted", async () => {
		const controller = await backgroundController();

		// @ts-expect-error exercising a value outside the type, as an untyped caller could pass
		await expect(controller.click({ x: 50, y: 70 }, "left", ["hyper"])).rejects.toThrow(
			"unsupported modifier: hyper",
		);

		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postKeyboardEvent).not.toHaveBeenCalled();
		controller.close();
	});
});

describe("#given a background command-click that told the target app it is active (idle release)", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		log.events.length = 0;
		vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
		setOnscreenWindowIdsSourceForTesting(() => [99]);
		const { setFocusStealWatcherForTesting } = await import("./macos-input.js");
		setFocusStealWatcherForTesting(() => undefined);
		skyLightMock.focusGuardFor.mockReturnValue({ previousPsn: Buffer.alloc(8, 1), targetPsn: Buffer.alloc(8, 2) });
		skyLightMock.setWindowAppActive.mockImplementation((_window: unknown, active: boolean) => {
			log.events.push(`active:${String(active)}`);
			return true;
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const releases = (): number => log.events.filter((event) => event === "active:false").length;

	it("#when no further modified gesture arrives #then the app is told it is inactive once the idle period passes", async () => {
		const { MODIFIED_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);
		vi.advanceTimersByTime(MODIFIED_ACTIVATION_IDLE_MILLISECONDS - 1);
		expect(releases()).toBe(0);
		vi.advanceTimersByTime(1);

		expect(releases()).toBe(1);
		controller.close();
		expect(releases()).toBe(1);
	});

	it("#when another modified gesture arrives inside the idle period #then the release is postponed", async () => {
		const { MODIFIED_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);
		vi.advanceTimersByTime(MODIFIED_ACTIVATION_IDLE_MILLISECONDS - 500);
		await controller.click({ x: 60, y: 70 }, "left", ["shift"]);
		vi.advanceTimersByTime(MODIFIED_ACTIVATION_IDLE_MILLISECONDS - 500);
		expect(releases()).toBe(0);
		vi.advanceTimersByTime(500);

		expect(releases()).toBe(1);
		controller.close();
	});

	it("#when the controller closes before the idle period #then the app is released once and no timer fires later", async () => {
		const { MODIFIED_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);
		controller.close();
		vi.advanceTimersByTime(MODIFIED_ACTIVATION_IDLE_MILLISECONDS * 2);

		expect(releases()).toBe(1);
	});
});
