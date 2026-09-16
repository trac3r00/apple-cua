import type { AppState, ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createGetAppStateTool } from "./get-app-state.js";

function state(overrides: Partial<AppState> = {}): AppState {
	return {
		app: "Finder",
		bundleId: "com.apple.finder",
		pid: 1234,
		frontmost: true,
		axAvailable: true,
		elements: [],
		screenshotBase64: "png-bytes",
		screenshotWidth: 2560,
		screenshotHeight: 1600,
		display: { width: 2560, height: 1600, scaleFactor: 2 },
		...overrides,
	};
}

function createComputer(resolved: AppState): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn<ComputerInterface["screenshot"]>(),
		setTarget: vi.fn<ComputerInterface["setTarget"]>(),
		move: vi.fn<ComputerInterface["move"]>(),
		click: vi.fn<ComputerInterface["click"]>(),
		rightClick: vi.fn<ComputerInterface["rightClick"]>(),
		middleClick: vi.fn<ComputerInterface["middleClick"]>(),
		doubleClick: vi.fn<ComputerInterface["doubleClick"]>(),
		type: vi.fn<ComputerInterface["type"]>(),
		key: vi.fn<ComputerInterface["key"]>(),
		scroll: vi.fn<ComputerInterface["scroll"]>(),
		drag: vi.fn<ComputerInterface["drag"]>(),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>(),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>(),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true }]),
		getAppState: vi.fn<ComputerInterface["getAppState"]>().mockResolvedValue(resolved),
		close: vi.fn<ComputerInterface["close"]>(),
	} as unknown as ComputerInterface;
}

describe("#given get_app_state tool #when executed #then it forwards the observation shape the caller asked for", () => {
	it("passes the screenshot, tree cap, menu bar, diff and window options through", async () => {
		const computer = createComputer(state());
		const tool = createGetAppStateTool(computer);

		await tool.execute(
			"tool-call",
			{
				app: "Finder",
				diff_only: true,
				include_screenshot: false,
				max_elements: 250,
				include_menu_bar: true,
				window_id: 99,
			},
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(computer.getAppState).toHaveBeenCalledWith(1234, {
			diffOnly: true,
			includeScreenshot: false,
			maxElements: 250,
			includeMenuBar: true,
			windowId: 99,
		});
	});

	it("omits the image content when the observation skipped the screenshot", async () => {
		const computer = createComputer(state({ screenshotBase64: "" }));
		const tool = createGetAppStateTool(computer);

		const result = await tool.execute(
			"tool-call",
			{ app: "Finder", include_screenshot: false },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(result.content.some((item) => item.type === "image")).toBe(false);
		expect(result.content.some((item) => item.type === "text")).toBe(true);
	});
});
