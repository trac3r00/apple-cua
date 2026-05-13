import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createScreenshotTool } from "./screenshot.js";

describe("#given screenshot tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_screenshot", () => {
		const computer = { screenshot: vi.fn() } as Pick<MacOSHostComputer, "screenshot"> as MacOSHostComputer;
		const tool = createScreenshotTool(computer);

		expect(tool.name).toBe("macos_cua_screenshot");
	});
});

describe("#given screenshot tool #when executed #then computer screenshot receives region", () => {
	it("returns image and text content", async () => {
		const screenshot = vi.fn<MacOSHostComputer["screenshot"]>().mockResolvedValue({
			data: Buffer.from("png"),
			mimeType: "image/png",
			width: 1920,
			height: 1080,
		});
		const computer = { screenshot } as Pick<MacOSHostComputer, "screenshot"> as MacOSHostComputer;
		const tool = createScreenshotTool(computer);

		const result = await tool.execute(
			"tool-call",
			{ region: { x: 1, y: 2, width: 3, height: 4 } },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(screenshot).toHaveBeenCalledWith({ region: { x: 1, y: 2, width: 3, height: 4 } });
		expect(result.content).toEqual([
			{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
			{ type: "text", text: "Screenshot 1920x1080" },
		]);
	});
});
