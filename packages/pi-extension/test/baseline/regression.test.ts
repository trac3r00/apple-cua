import type { ComputerInterface } from "@macos-cua/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../../src/pi/index.js";
import { createClickTool } from "../../src/tools/click.js";
import { createKeyTool } from "../../src/tools/key.js";
import { createScreenshotTool } from "../../src/tools/screenshot.js";
import { createScrollTool } from "../../src/tools/scroll.js";
import { createTypeTool } from "../../src/tools/type.js";

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
			screenshotBase64: "",
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: vi.fn<ComputerInterface["listApps"]>().mockResolvedValue([]),
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

	describe("screenshot", () => {
		it("returns a PNG buffer with valid header", async () => {
			const tool = createScreenshotTool(computer);
			const result = await tool.execute("tc", {}, undefined, undefined, context);

			expect(computer.screenshot).toHaveBeenCalledTimes(1);
			expect(result.content).toHaveLength(2);
			expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
		});
	});

	describe("click", () => {
		it("dispatches click to the computer with coordinates", async () => {
			const tool = createClickTool(computer);
			await tool.execute("tc", { x: 100, y: 200, button: "left" }, undefined, undefined, context);

			expect(computer.click).toHaveBeenCalledTimes(1);
			expect(computer.click).toHaveBeenCalledWith({ x: 100, y: 200 });
		});
	});

	describe("type", () => {
		it("types ASCII text without error", async () => {
			const tool = createTypeTool(computer);
			await tool.execute("tc", { text: "Hello, world!" }, undefined, undefined, context);

			expect(computer.type).toHaveBeenCalledTimes(1);
			expect(computer.type).toHaveBeenCalledWith("Hello, world!");
		});

		it("types Korean IME text '안녕하세요' without error", async () => {
			const tool = createTypeTool(computer);
			await tool.execute("tc", { text: "안녕하세요" }, undefined, undefined, context);

			expect(computer.type).toHaveBeenCalledTimes(1);
			expect(computer.type).toHaveBeenCalledWith("안녕하세요");
		});
	});

	describe("key with modifiers", () => {
		it("presses a key with command modifier", async () => {
			const tool = createKeyTool(computer);
			await tool.execute("tc", { key: "c", modifiers: ["command"] }, undefined, undefined, context);

			expect(computer.key).toHaveBeenCalledTimes(1);
			expect(computer.key).toHaveBeenCalledWith("c", { modifiers: ["command"] });
		});

		it("presses a key with multiple modifiers", async () => {
			const tool = createKeyTool(computer);
			await tool.execute("tc", { key: "t", modifiers: ["cmd", "shift"] }, undefined, undefined, context);

			expect(computer.key).toHaveBeenCalledTimes(1);
			expect(computer.key).toHaveBeenCalledWith("t", { modifiers: ["command", "shift"] });
		});
	});

	describe("scroll", () => {
		it("scrolls down by the requested amount", async () => {
			const tool = createScrollTool(computer);
			await tool.execute("tc", { direction: "down", amount: 5 }, undefined, undefined, context);

			expect(computer.scroll).toHaveBeenCalledTimes(1);
			expect(computer.scroll).toHaveBeenCalledWith({ direction: "down", amount: 5 });
		});
	});
});
