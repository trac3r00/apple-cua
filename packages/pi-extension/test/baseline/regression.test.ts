import type { ComputerInterface } from "@macos-cua/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../../src/pi/index.js";
import { createClickTool } from "../../src/tools/click.js";
import { createGetAppStateTool } from "../../src/tools/get-app-state.js";
import { createPressKeyTool } from "../../src/tools/press-key.js";
import { createScrollTool } from "../../src/tools/scroll.js";
import { createTypeTextTool } from "../../src/tools/type-text.js";

function createFakeComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn<ComputerInterface["screenshot"]>().mockResolvedValue({
			data: Buffer.from("89504e470d0a1a0a", "hex"),
			mimeType: "image/png",
			width: 100,
			height: 80,
		}),
		setTarget: vi.fn<ComputerInterface["setTarget"]>(),
		move: vi.fn<ComputerInterface["move"]>().mockResolvedValue(undefined),
		click: vi.fn<ComputerInterface["click"]>().mockResolvedValue(undefined),
		rightClick: vi.fn<ComputerInterface["rightClick"]>().mockResolvedValue(undefined),
		middleClick: vi.fn<ComputerInterface["middleClick"]>().mockResolvedValue(undefined),
		doubleClick: vi.fn<ComputerInterface["doubleClick"]>().mockResolvedValue(undefined),
		type: vi.fn<ComputerInterface["type"]>().mockResolvedValue(undefined),
		key: vi.fn<ComputerInterface["key"]>().mockResolvedValue(undefined),
		scroll: vi.fn<ComputerInterface["scroll"]>().mockResolvedValue(undefined),
		drag: vi.fn<ComputerInterface["drag"]>().mockResolvedValue(undefined),
		getCursorPosition: vi.fn<ComputerInterface["getCursorPosition"]>().mockResolvedValue({ x: 0, y: 0 }),
		getScreenSize: vi.fn<ComputerInterface["getScreenSize"]>().mockResolvedValue({ width: 100, height: 80 }),
		getAppState: vi.fn<ComputerInterface["getAppState"]>().mockResolvedValue({
			app: "TestApp",
			bundleId: "com.test.app",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [],
			screenshotBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: vi
			.fn<ComputerInterface["listApps"]>()
			.mockResolvedValue([{ name: "TestApp", bundleId: "com.test.app", pid: 1234, isRunning: true }]),
		setValue: vi.fn<ComputerInterface["setValue"]>().mockResolvedValue(undefined),
		performAction: vi.fn<ComputerInterface["performAction"]>().mockResolvedValue(undefined),
		close: vi.fn<ComputerInterface["close"]>().mockResolvedValue(undefined),
	};
}

const context = {} as ExtensionContext;

describe("#given baseline regression suite #when exercising computer interface #then behaviors are locked", () => {
	let computer: ReturnType<typeof createFakeComputer>;

	beforeEach(() => {
		computer = createFakeComputer();
		vi.clearAllMocks();
	});

	describe("get_app_state", () => {
		it("returns PNG image content with app state text", async () => {
			const tool = createGetAppStateTool(computer);
			const result = await tool.execute("tc", { app: "TestApp" }, undefined, undefined, context);

			expect(computer.getAppState).toHaveBeenCalledTimes(1);
			expect(result.content).toHaveLength(2);
			expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
		});
	});

	describe("click", () => {
		it("dispatches click to the computer with coordinates", async () => {
			const tool = createClickTool(computer);
			await tool.execute("tc", { app: "TestApp", x: 100, y: 200 }, undefined, undefined, context);

			expect(computer.click).toHaveBeenCalledTimes(1);
			expect(computer.click).toHaveBeenCalledWith({ x: 100, y: 200 });
		});
	});

	describe("type", () => {
		it("types ASCII text without error", async () => {
			const tool = createTypeTextTool(computer);
			await tool.execute("tc", { app: "TestApp", text: "Hello, world!" }, undefined, undefined, context);

			expect(computer.type).toHaveBeenCalledTimes(1);
			expect(computer.type).toHaveBeenCalledWith("Hello, world!");
		});

		it("types Korean IME text '안녕하세요' without error", async () => {
			const tool = createTypeTextTool(computer);
			await tool.execute("tc", { app: "TestApp", text: "안녕하세요" }, undefined, undefined, context);

			expect(computer.type).toHaveBeenCalledTimes(1);
			expect(computer.type).toHaveBeenCalledWith("안녕하세요");
		});
	});

	describe("key with modifiers", () => {
		it("presses a key with command modifier", async () => {
			const tool = createPressKeyTool(computer);
			await tool.execute("tc", { app: "TestApp", key: "command+c" }, undefined, undefined, context);

			expect(computer.key).toHaveBeenCalledTimes(1);
			expect(computer.key).toHaveBeenCalledWith("c", { modifiers: ["command"] });
		});

		it("presses a key with multiple modifiers", async () => {
			const tool = createPressKeyTool(computer);
			await tool.execute("tc", { app: "TestApp", key: "cmd+shift+t" }, undefined, undefined, context);

			expect(computer.key).toHaveBeenCalledTimes(1);
			expect(computer.key).toHaveBeenCalledWith("t", { modifiers: ["command", "shift"] });
		});
	});

	describe("scroll", () => {
		it("performs AXScrollDownByPage on the requested element_index pages times", async () => {
			const tool = createScrollTool(computer);
			await tool.execute(
				"tc",
				{ app: "TestApp", direction: "down", pages: 5, element_index: "3" },
				undefined,
				undefined,
				context,
			);

			expect(computer.scroll).not.toHaveBeenCalled();
			expect(computer.performAction).toHaveBeenCalledTimes(5);
			expect(computer.performAction).toHaveBeenNthCalledWith(1, 1234, 3, "AXScrollDownByPage");
		});
	});
});
