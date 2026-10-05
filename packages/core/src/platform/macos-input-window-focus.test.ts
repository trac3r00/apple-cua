import { beforeEach, describe, expect, it, vi } from "vitest";

import { setOnscreenWindowIdsSourceForTesting } from "./macos-input.js";
import { setOpenWindowsSourceForTesting } from "./macos-open-windows.js";

const accessibilityMock = vi.hoisted(() => ({
	focusedElementInWebArea: vi.fn(() => false),
	focusedWindowIdForPid: vi.fn<(pid: number) => number | undefined>(),
	focusedWindowIsModal: vi.fn(() => false),
	focusedWindowShowsFilePanel: vi.fn(() => false),
	raiseWindowInApp: vi.fn<(pid: number, windowId: number) => boolean>(() => true),
	windowTitlesForPid: vi.fn<(pid: number) => ReadonlyMap<number, string>>(() => new Map()),
}));

const coreGraphicsMock = vi.hoisted(() => ({
	getCurrentCursorPosition: vi.fn(() => ({ x: 1, y: 2 })),
	postKeyboardEvent: vi.fn(),
	postMouseEvent: vi.fn(),
	postScrollEvent: vi.fn(),
	postUnicodeText: vi.fn(),
	warpCursorPosition: vi.fn(),
}));

vi.mock("./macos-ffi/accessibility.js", () => accessibilityMock);
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));
vi.mock("./macos-ffi/skylight.js", () => ({
	focusGuardFor: () => null,
	frontProcessSerialNumber: () => null,
	setProcessAppActive: vi.fn(),
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

const A_TXT = { id: 71, bounds: { x: 100, y: 100, width: 600, height: 400 } };
const B_TXT = { id: 72, bounds: { x: 140, y: 130, width: 600, height: 400 } };

// Two documents of one app, untitled in the WindowServer listing, as a process without Screen Recording sees them.
setOpenWindowsSourceForTesting(() =>
	[A_TXT, B_TXT].map((window) => ({
		id: window.id,
		owner: { processId: 1234, name: "TextEdit" },
		title: "",
		bounds: window.bounds,
		layer: 0,
	})),
);

async function controllerOnB() {
	const { MacOSInputController } = await import("./macos-input.js");
	const controller = new MacOSInputController(
		1234,
		undefined,
		() => false,
		{ acquire: vi.fn(), release: vi.fn() },
		"background",
	);
	await controller.rememberTargetWindow(1234, B_TXT.id);
	return controller;
}

describe("#given keys or a window command for b.txt while the app's focused window is another one", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setOnscreenWindowIdsSourceForTesting(() => [A_TXT.id, B_TXT.id]);
		accessibilityMock.windowTitlesForPid.mockReturnValue(
			new Map([
				[A_TXT.id, "a.txt"],
				[B_TXT.id, "b.txt"],
			]),
		);
	});

	it("#when another document has focus #then b.txt is raised inside its app first, the app naming the focused window", async () => {
		accessibilityMock.focusedWindowIdForPid.mockReturnValue(A_TXT.id);
		const controller = await controllerOnB();

		await controller.pressKey("a");

		expect(accessibilityMock.raiseWindowInApp).toHaveBeenCalledWith(1234, B_TXT.id);
		expect(coreGraphicsMock.postKeyboardEvent).toHaveBeenCalledWith(
			expect.objectContaining({ targetPid: 1234, targetWindow: B_TXT }),
		);
		controller.close();
	});

	it("#when a window command is aimed at b.txt #then b.txt is raised the same way before it runs", async () => {
		accessibilityMock.focusedWindowIdForPid.mockReturnValue(A_TXT.id);
		const controller = await controllerOnB();
		const order: string[] = [];
		accessibilityMock.raiseWindowInApp.mockImplementation((_pid, windowId) => {
			order.push(`raise:${windowId}`);
			return true;
		});

		await controller.withWindowCommand(
			1234,
			B_TXT,
			() => false,
			async () => {
				order.push("command");
			},
		);

		expect(order).toEqual(["raise:72", "command"]);
		controller.close();
	});

	it("#when the focused window is an untitled helper of b.txt's own interaction #then nothing is raised over it", async () => {
		accessibilityMock.focusedWindowIdForPid.mockReturnValue(75);
		const controller = await controllerOnB();

		await controller.pressKey("Return");

		expect(accessibilityMock.raiseWindowInApp).not.toHaveBeenCalled();
		controller.close();
	});

	it("#when b.txt already has focus #then nothing is raised", async () => {
		accessibilityMock.focusedWindowIdForPid.mockReturnValue(B_TXT.id);
		const controller = await controllerOnB();

		await controller.pressKey("a");

		expect(accessibilityMock.raiseWindowInApp).not.toHaveBeenCalled();
		controller.close();
	});
});
