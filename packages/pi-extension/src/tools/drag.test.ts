import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createDragTool } from "./drag.js";

describe("#given drag tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_drag", () => {
		const computer = { drag: vi.fn() } as Pick<MacOSHostComputer, "drag"> as MacOSHostComputer;
		const tool = createDragTool(computer);

		expect(tool.name).toBe("macos_cua_drag");
	});
});

describe("#given drag tool #when executed #then computer drag receives endpoints", () => {
	it("drags from start to end", async () => {
		const drag = vi.fn<MacOSHostComputer["drag"]>().mockResolvedValue(undefined);
		const computer = { drag } as Pick<MacOSHostComputer, "drag"> as MacOSHostComputer;
		const tool = createDragTool(computer);

		await tool.execute(
			"tool-call",
			{ fromX: 1, fromY: 2, toX: 3, toY: 4 },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(drag).toHaveBeenCalledWith({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
	});
});
