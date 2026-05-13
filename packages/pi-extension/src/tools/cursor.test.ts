import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createCursorPositionTool } from "./cursor.js";

describe("#given cursor position tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_cursor_position", () => {
		const computer = { getCursorPosition: vi.fn() } as Pick<
			MacOSHostComputer,
			"getCursorPosition"
		> as MacOSHostComputer;
		const tool = createCursorPositionTool(computer);

		expect(tool.name).toBe("macos_cua_cursor_position");
	});
});

describe("#given cursor position tool #when executed #then computer getCursorPosition is called", () => {
	it("returns cursor position details", async () => {
		const getCursorPosition = vi.fn<MacOSHostComputer["getCursorPosition"]>().mockResolvedValue({ x: 7, y: 8 });
		const computer = { getCursorPosition } as Pick<MacOSHostComputer, "getCursorPosition"> as MacOSHostComputer;
		const tool = createCursorPositionTool(computer);

		const result = await tool.execute("tool-call", {}, undefined, undefined, {} as ExtensionContext);

		expect(getCursorPosition).toHaveBeenCalledWith();
		expect(result.details).toEqual({ x: 7, y: 8 });
	});
});
