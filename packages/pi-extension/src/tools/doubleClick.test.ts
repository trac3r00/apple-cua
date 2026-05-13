import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createDoubleClickTool } from "./doubleClick.js";

describe("#given double click tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_double_click", () => {
		const computer = { doubleClick: vi.fn() } as Pick<MacOSHostComputer, "doubleClick"> as MacOSHostComputer;
		const tool = createDoubleClickTool(computer);

		expect(tool.name).toBe("macos_cua_double_click");
	});
});

describe("#given double click tool #when executed #then computer doubleClick receives coordinates", () => {
	it("double-clicks the requested point", async () => {
		const doubleClick = vi.fn<MacOSHostComputer["doubleClick"]>().mockResolvedValue(undefined);
		const computer = { doubleClick } as Pick<MacOSHostComputer, "doubleClick"> as MacOSHostComputer;
		const tool = createDoubleClickTool(computer);

		await tool.execute("tool-call", { x: 30, y: 40, button: "left" }, undefined, undefined, {} as ExtensionContext);

		expect(doubleClick).toHaveBeenCalledWith({ x: 30, y: 40 });
	});
});
