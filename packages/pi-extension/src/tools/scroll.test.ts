import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createScrollTool } from "./scroll.js";

describe("#given scroll tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_scroll", () => {
		const computer = { scroll: vi.fn() } as Pick<MacOSHostComputer, "scroll"> as MacOSHostComputer;
		const tool = createScrollTool(computer);

		expect(tool.name).toBe("macos_cua_scroll");
	});
});

describe("#given scroll tool #when executed #then computer scroll receives direction and amount", () => {
	it("scrolls by the requested amount", async () => {
		const scroll = vi.fn<MacOSHostComputer["scroll"]>().mockResolvedValue(undefined);
		const computer = { scroll } as Pick<MacOSHostComputer, "scroll"> as MacOSHostComputer;
		const tool = createScrollTool(computer);

		await tool.execute("tool-call", { direction: "down", amount: 5 }, undefined, undefined, {} as ExtensionContext);

		expect(scroll).toHaveBeenCalledWith({ direction: "down", amount: 5 });
	});
});
