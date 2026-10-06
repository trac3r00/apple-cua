import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setOnscreenWindowIdsSourceForTesting } from "./macos-input.js";
import { setOpenWindowsSourceForTesting } from "./macos-open-windows.js";

const WINDOW = { id: 99, bounds: { x: 10, y: 20, width: 300, height: 200 } };
const OTHER_WINDOW = { id: 98, bounds: { x: 400, y: 20, width: 300, height: 200 } };
const MAIN_DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
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

const skyLightMock = vi.hoisted(() => {
	const personPsn = Buffer.alloc(8, 1);
	const targetPsn = Buffer.alloc(8, 2);
	const state = { front: personPsn };
	return {
		focusGuardFor: vi.fn(),
		frontProcessSerialNumber: vi.fn(() => state.front),
		setProcessAppActive: vi.fn<(psn: Buffer, windowId: number, active: boolean) => boolean>(),
		personPsn,
		targetPsn,
		state,
	};
});

vi.mock("get-windows", () => ({
	openWindows: vi.fn(() =>
		Promise.resolve(
			[WINDOW, OTHER_WINDOW].map((window) => ({ id: window.id, owner: { processId: 1234 }, bounds: window.bounds })),
		),
	),
}));
setOpenWindowsSourceForTesting(() => undefined);
// The focus-lease and primer pauses only give a real app time to react; no assertion here depends on them.
vi.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
vi.mock("./macos-ffi/skylight.js", () => ({
	focusGuardFor: skyLightMock.focusGuardFor,
	frontProcessSerialNumber: skyLightMock.frontProcessSerialNumber,
	setProcessAppActive: skyLightMock.setProcessAppActive,
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

async function backgroundController(delivery: "background" | "attended" = "background", backgroundActivation = true) {
	const { MacOSInputController } = await import("./macos-input.js");
	return new MacOSInputController(
		1234,
		{ set: vi.fn(), highlight: vi.fn(), setMode: vi.fn(), hide: vi.fn(), close: vi.fn() },
		() => false,
		{ acquire: vi.fn(), release: vi.fn() },
		delivery,
		backgroundActivation,
	);
}

/** The app behind the person's, its activation recorded as `active:<state>:<window>` among the posted events. */
async function resetDesktop(): Promise<void> {
	vi.clearAllMocks();
	log.events.length = 0;
	setOnscreenWindowIdsSourceForTesting(() => [99, 98]);
	const {
		setFocusStealWatcherForTesting,
		setKeyboardWindowFocuserForTesting,
		setKeyboardPidResolverForTesting,
		setScreenLayoutSourceForTesting,
	} = await import("./macos-input.js");
	setScreenLayoutSourceForTesting(() => ({ displays: [MAIN_DISPLAY], windows: [WINDOW.bounds, OTHER_WINDOW.bounds] }));
	setFocusStealWatcherForTesting(() => undefined);
	setKeyboardPidResolverForTesting((pid) => pid);
	setKeyboardWindowFocuserForTesting(async (pid, windowId) => {
		log.events.push(`focus:${pid}:${windowId}`);
	});
	skyLightMock.state.front = skyLightMock.personPsn;
	skyLightMock.focusGuardFor.mockReturnValue({
		previousPsn: skyLightMock.personPsn,
		targetPsn: skyLightMock.targetPsn,
	});
	skyLightMock.setProcessAppActive.mockImplementation((_psn, windowId, active) => {
		log.events.push(`active:${String(active)}:${windowId}`);
		return true;
	});
	coreGraphicsMock.postKeyboardEvent.mockImplementation((call) => {
		log.events.push(`key:${String(call.keyCode)}:${call.keyDown ? "down" : "up"}:${call.flags.toString(16)}`);
	});
	coreGraphicsMock.postMouseEvent.mockImplementation((call) => {
		log.events.push(`mouse:${call.kind}:${call.position.x},${call.position.y}:${(call.flags ?? 0).toString(16)}`);
	});
}

const PRIMER = ["mouse:down:-1,-1:0", "mouse:up:-1,-1:0"];

describe("#given a background controller holding modifiers across a pointer gesture", () => {
	beforeEach(resetDesktop);

	it("#when command-clicking #then the app is activated, primed, the key goes down, the click carries the flag, and the key goes up", async () => {
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);

		expect(log.events).toEqual([
			"active:true:99",
			...PRIMER,
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

	it("#when clicking without modifiers #then the app is still told it is active and primed, so the click is not spent on activating the window", async () => {
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });

		expect(coreGraphicsMock.postKeyboardEvent).not.toHaveBeenCalled();
		expect(log.events).toEqual(["active:true:99", ...PRIMER, "mouse:down:50,70:0", "mouse:up:50,70:0"]);
		expect(coreGraphicsMock.postMouseEvent.mock.calls.at(-1)?.[0].flags).toBeUndefined();
		controller.close();
	});

	it("#when double-clicking or dragging without modifiers #then each gesture is primed behind the person's app first", async () => {
		const clicker = await backgroundController();
		await clicker.doubleClick({ x: 50, y: 70 });

		expect(log.events).toEqual([
			"active:true:99",
			...PRIMER,
			"mouse:down:50,70:0",
			"mouse:up:50,70:0",
			"mouse:down:50,70:0",
			"mouse:up:50,70:0",
		]);
		clicker.close();
		log.events.length = 0;

		const dragger = await backgroundController();
		await dragger.drag({ from: { x: 20, y: 30 }, to: { x: 60, y: 30 } });

		expect(log.events.slice(0, 3)).toEqual(["active:true:99", ...PRIMER]);
		expect(log.events.at(-1)).toBe("mouse:up:60,30:0");
		dragger.close();
	});

	it("#when the target app is already frontmost #then it is not told anything about activation", async () => {
		const controller = await backgroundController();
		skyLightMock.focusGuardFor.mockReturnValue(null);

		await controller.click({ x: 50, y: 70 }, "left", ["shift"]);
		await controller.click({ x: 50, y: 70 });

		expect(skyLightMock.setProcessAppActive).not.toHaveBeenCalled();
		expect(log.events).toEqual([
			"key:56:down:20000",
			"mouse:down:50,70:20000",
			"mouse:up:50,70:20000",
			"key:56:up:0",
			"mouse:down:50,70:0",
			"mouse:up:50,70:0",
		]);
		controller.close();
	});

	it("#when a held app is clicked in another of its windows #then it is told again, naming that window, and primed again", async () => {
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });
		await controller.click({ x: 60, y: 70 });
		await controller.click({ x: 450, y: 70 });

		expect(log.events.filter((event) => event.startsWith("active:"))).toEqual(["active:true:99", "active:true:98"]);
		expect(log.events.filter((event) => event === PRIMER[0]).length).toBe(2);
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

	it("#when scrolling without modifiers #then the wheel needs no activation and none is made", async () => {
		const controller = await backgroundController();
		await controller.rememberTargetWindow(1234);

		await controller.scroll({ direction: "down", amount: 4 });

		expect(skyLightMock.setProcessAppActive).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postScrollEvent).toHaveBeenCalled();
		controller.close();
	});

	it("#when the controller closes #then apps it told were active are told otherwise", async () => {
		const controller = await backgroundController();
		await controller.click({ x: 50, y: 70 }, "left", ["command"]);
		skyLightMock.setProcessAppActive.mockClear();

		controller.close();

		expect(skyLightMock.setProcessAppActive).toHaveBeenCalledWith(skyLightMock.targetPsn, 99, false);
	});

	it("#when a modifier name is unknown #then the click is refused before anything is posted", async () => {
		const controller = await backgroundController();

		// @ts-expect-error exercising a value outside the type, as an untyped caller could pass
		await expect(controller.click({ x: 50, y: 70 }, "left", ["hyper"])).rejects.toThrow(
			"unsupported modifier: hyper",
		);

		expect(coreGraphicsMock.postMouseEvent).not.toHaveBeenCalled();
		expect(coreGraphicsMock.postKeyboardEvent).not.toHaveBeenCalled();
		expect(skyLightMock.setProcessAppActive).not.toHaveBeenCalled();
		controller.close();
	});
});

describe("#given an app behind the person's told it is active for a click (where its primer goes)", () => {
	beforeEach(resetDesktop);

	it("#when a display at a negative origin above and left of the main one covers (-1, -1) #then the primer clicks just outside every display and window, sent to the target window only", async () => {
		const { setScreenLayoutSourceForTesting } = await import("./macos-input.js");
		setScreenLayoutSourceForTesting(() => ({
			displays: [MAIN_DISPLAY, { x: -2560, y: -1440, width: 2560, height: 1440 }],
			windows: [WINDOW.bounds, OTHER_WINDOW.bounds, { x: -1200, y: -900, width: 1199, height: 899 }],
		}));
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });

		expect(log.events).toEqual([
			"active:true:99",
			"mouse:down:-2561,-1441:0",
			"mouse:up:-2561,-1441:0",
			"mouse:down:50,70:0",
			"mouse:up:50,70:0",
		]);
		expect(coreGraphicsMock.postMouseEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "down",
				position: { x: -2561, y: -1441 },
				targetPid: 1234,
				targetWindow: WINDOW,
			}),
		);
		controller.close();
	});

	it("#when the display and window layout cannot be read #then the primer is skipped and logged, and the click still goes out", async () => {
		const { setScreenLayoutSourceForTesting } = await import("./macos-input.js");
		setScreenLayoutSourceForTesting(() => undefined);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const controller = await backgroundController();

		try {
			await controller.click({ x: 50, y: 70 });

			expect(log.events).toEqual(["active:true:99", "mouse:down:50,70:0", "mouse:up:50,70:0"]);
			expect(stderr).toHaveBeenCalledWith(expect.stringContaining("activation primer skipped"));
			expect(controller.holdsActivation(1234)).toBe(true);
		} finally {
			stderr.mockRestore();
			controller.close();
		}
	});
});

describe("#given background activation turned off (APPLE_CUA_BACKGROUND_ACTIVATION=off)", () => {
	beforeEach(resetDesktop);

	it.each([
		[undefined, true],
		["on", true],
		["off", false],
		[" OFF ", false],
		["0", false],
		["false", false],
		["no", false],
	])("#when the variable is %j #then background activation is %s", async (value, enabled) => {
		const { backgroundActivationEnabled } = await import("./macos-input.js");

		expect(backgroundActivationEnabled(value === undefined ? {} : { APPLE_CUA_BACKGROUND_ACTIVATION: value })).toBe(
			enabled,
		);
	});

	it("#when clicking and running a window command behind the person's app #then the app is never told it is active, gets no primer, and nothing is held or released", async () => {
		const controller = await backgroundController("background", false);

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);
		await controller.withWindowCommand(
			1234,
			OTHER_WINDOW,
			() => true,
			async (held) => {
				log.events.push(`command:${String(held)}`);
			},
		);
		controller.close();

		expect(skyLightMock.setProcessAppActive).not.toHaveBeenCalled();
		expect(log.events).toEqual([
			"key:55:down:100000",
			"mouse:down:50,70:100000",
			"mouse:up:50,70:100000",
			"key:55:up:0",
			"focus:1234:98",
			"command:false",
		]);
		expect(controller.holdsActivation(1234)).toBe(false);
	});
});

describe("#given a window command (a menu item or key equivalent) for one window of an app behind the person's", () => {
	beforeEach(resetDesktop);

	it("#when the command wants the app active #then that window is focused first, the app is told it is active for it and primed, and the command runs held", async () => {
		const controller = await backgroundController();

		const answer = await controller.withWindowCommand(
			1234,
			OTHER_WINDOW,
			() => true,
			async (held) => {
				log.events.push(`command:${String(held)}`);
				return "done";
			},
		);

		expect(answer).toBe("done");
		expect(log.events).toEqual(["focus:1234:98", "active:true:98", ...PRIMER, "command:true"]);
		expect(controller.holdsActivation(1234)).toBe(true);
		controller.close();
	});

	it("#when the command does not want activation #then the window is still focused but the app is told nothing", async () => {
		const controller = await backgroundController();

		await controller.withWindowCommand(
			1234,
			OTHER_WINDOW,
			() => false,
			async (held) => {
				log.events.push(`command:${String(held)}`);
			},
		);

		expect(log.events).toEqual(["focus:1234:98", "command:false"]);
		expect(controller.holdsActivation(1234)).toBe(false);
		controller.close();
	});

	it("#when the app is the person's frontmost one #then it is not told anything and the command runs unheld", async () => {
		const controller = await backgroundController();
		skyLightMock.focusGuardFor.mockReturnValue(null);

		await controller.withWindowCommand(
			1234,
			WINDOW,
			() => true,
			async (held) => {
				log.events.push(`command:${String(held)}`);
			},
		);

		expect(log.events).toEqual(["focus:1234:99", "command:false"]);
		controller.close();
	});

	it("#when the app is already held for that window #then the command runs held without another activation", async () => {
		const controller = await backgroundController();
		await controller.click({ x: 50, y: 70 });
		log.events.length = 0;
		const wantsActivation = vi.fn(() => false);

		await controller.withWindowCommand(1234, WINDOW, wantsActivation, async (held) => {
			log.events.push(`command:${String(held)}`);
		});

		expect(wantsActivation).not.toHaveBeenCalled();
		expect(log.events).toEqual(["focus:1234:99", "command:true"]);
		controller.close();
	});

	it("#when delivery is attended #then the window is focused and the app is never told it is active", async () => {
		const controller = await backgroundController("attended");

		await controller.withWindowCommand(
			1234,
			WINDOW,
			() => true,
			async (held) => {
				log.events.push(`command:${String(held)}`);
			},
		);

		expect(log.events).toEqual(["focus:1234:99", "command:false"]);
		controller.close();
	});
});

describe("#given an app behind the person's that background input told it is active (idle release)", () => {
	beforeEach(async () => {
		await resetDesktop();
		vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const releases = (): number => log.events.filter((event) => event.startsWith("active:false")).length;

	it("#when no further action arrives #then the app is told it is inactive once the idle period passes", async () => {
		const { BACKGROUND_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS - 1);
		expect(releases()).toBe(0);
		vi.advanceTimersByTime(1);

		expect(releases()).toBe(1);
		expect(skyLightMock.setProcessAppActive).toHaveBeenLastCalledWith(skyLightMock.targetPsn, 99, false);
		controller.close();
		expect(releases()).toBe(1);
	});

	it("#when another gesture arrives inside the idle period #then the release is postponed", async () => {
		const { BACKGROUND_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS - 500);
		await controller.click({ x: 60, y: 70 });
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS - 500);
		expect(releases()).toBe(0);
		vi.advanceTimersByTime(500);

		expect(releases()).toBe(1);
		controller.close();
	});

	it("#when keys reach the held app inside the idle period #then they keep it active too", async () => {
		const { BACKGROUND_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS - 500);
		await controller.pressKey("Return");
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS - 500);
		expect(releases()).toBe(0);
		vi.advanceTimersByTime(500);

		expect(releases()).toBe(1);
		controller.close();
	});

	it("#when a window command ran held #then the app is released once the idle period after it passes", async () => {
		const { BACKGROUND_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.withWindowCommand(
			1234,
			WINDOW,
			() => true,
			async () => undefined,
		);
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS);

		expect(releases()).toBe(1);
		expect(controller.holdsActivation(1234)).toBe(false);
		controller.close();
	});

	it("#when the person brings the app forward meanwhile #then it is not told it is inactive", async () => {
		const { BACKGROUND_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });
		skyLightMock.state.front = skyLightMock.targetPsn;
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS);

		expect(releases()).toBe(0);
		expect(controller.holdsActivation(1234)).toBe(false);
		controller.close();
		expect(releases()).toBe(0);
	});

	it("#when the process exits while an app is held #then its exit hook tells the app otherwise, and the hook is gone once nothing is held", async () => {
		const before = process.listeners("exit");
		const added = () => process.listeners("exit").filter((listener) => !before.includes(listener));
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 });
		const [hook, ...others] = added();
		expect(others).toEqual([]);
		hook?.(0);

		expect(log.events.at(-1)).toBe("active:false:99");
		expect(controller.holdsActivation(1234)).toBe(false);
		expect(added()).toEqual([]);
		controller.close();
		expect(releases()).toBe(1);
	});

	it("#when the controller closes before the idle period #then the app is released once and no timer fires later", async () => {
		const { BACKGROUND_ACTIVATION_IDLE_MILLISECONDS } = await import("./macos-input.js");
		const controller = await backgroundController();

		await controller.click({ x: 50, y: 70 }, "left", ["cmd"]);
		controller.close();
		vi.advanceTimersByTime(BACKGROUND_ACTIVATION_IDLE_MILLISECONDS * 2);

		expect(releases()).toBe(1);
	});
});
