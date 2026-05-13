import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createClickTool } from "./click.js";

describe("#given click tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_click", () => {
		const computer = { click: vi.fn() } as Pick<MacOSHostComputer, "click"> as MacOSHostComputer;
		const tool = createClickTool(computer);

		expect(tool.name).toBe("macos_cua_click");
	});
});

describe("#given click tool #when executed #then computer click receives coordinates", () => {
	it("clicks the requested point", async () => {
		const click = vi.fn<MacOSHostComputer["click"]>().mockResolvedValue(undefined);
		const computer = { click } as Pick<MacOSHostComputer, "click"> as MacOSHostComputer;
		const tool = createClickTool(computer);

		await tool.execute("tool-call", { x: 10, y: 20, button: "left" }, undefined, undefined, {} as ExtensionContext);

		expect(click).toHaveBeenCalledWith({ x: 10, y: 20 });
	});
});
