import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createScreenSizeTool } from "./screen.js";

describe("#given screen size tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_screen_size", () => {
		const computer = { getScreenSize: vi.fn() } as Pick<MacOSHostComputer, "getScreenSize"> as MacOSHostComputer;
		const tool = createScreenSizeTool(computer);

		expect(tool.name).toBe("macos_cua_screen_size");
	});
});

describe("#given screen size tool #when executed #then computer getScreenSize is called", () => {
	it("returns screen size details", async () => {
		const getScreenSize = vi.fn<MacOSHostComputer["getScreenSize"]>().mockResolvedValue({ width: 1440, height: 900 });
		const computer = { getScreenSize } as Pick<MacOSHostComputer, "getScreenSize"> as MacOSHostComputer;
		const tool = createScreenSizeTool(computer);

		const result = await tool.execute("tool-call", {}, undefined, undefined, {} as ExtensionContext);

		expect(getScreenSize).toHaveBeenCalledWith();
		expect(result.details).toEqual({ width: 1440, height: 900 });
	});
});
