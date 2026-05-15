import type { ComputerInterface } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import { anthropicComputerToolSchema } from "../../src/anthropic-computer-use.js";
import { buildAllTools } from "../../src/tools/index.js";

function estimateTokens(byteLength: number): number {
	return Math.ceil(byteLength / 4);
}

function createFakeComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn<ComputerInterface["screenshot"]>().mockResolvedValue({
			data: Buffer.from("png"),
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
			screenshotBase64: "",
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: vi.fn<ComputerInterface["listApps"]>().mockResolvedValue([]),
		setValue: vi.fn<ComputerInterface["setValue"]>().mockResolvedValue(undefined),
		performAction: vi.fn<ComputerInterface["performAction"]>().mockResolvedValue(undefined),
		close: vi.fn<ComputerInterface["close"]>().mockResolvedValue(undefined),
	};
}

describe("#given all registered tools #when schemas are serialized #then byte and token counts are recorded", () => {
	it("counts Codex-compatible tools and native computer tool descriptors", () => {
		const fakeComputer = createFakeComputer();

		const tools = buildAllTools({ computer: fakeComputer });
		expect(tools.length).toBe(9);

		let totalBytes = 0;
		for (const tool of tools) {
			const schemaJson = JSON.stringify(tool.parameters);
			totalBytes += Buffer.byteLength(schemaJson, "utf8");
		}

		const nativeSchemaJson = JSON.stringify(anthropicComputerToolSchema);
		totalBytes += Buffer.byteLength(nativeSchemaJson, "utf8");

		const estimatedTokens = estimateTokens(totalBytes);

		const metrics = {
			tool_descriptor_bytes: totalBytes,
			tool_descriptor_estimated_tokens: estimatedTokens,
			tool_count: tools.length + 1,
			computer_use_tool_count: tools.length,
			native_computer_tool_bytes: Buffer.byteLength(nativeSchemaJson, "utf8"),
		};

		expect(metrics.tool_descriptor_bytes).toBeGreaterThan(0);
		expect(metrics.tool_descriptor_estimated_tokens).toBeGreaterThan(0);
		expect(metrics.tool_count).toBe(10);
	});
});
