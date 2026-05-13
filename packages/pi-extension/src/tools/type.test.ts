import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createTypeTool } from "./type.js";

describe("#given type tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_type", () => {
		const computer = { type: vi.fn() } as Pick<MacOSHostComputer, "type"> as MacOSHostComputer;
		const tool = createTypeTool(computer);

		expect(tool.name).toBe("macos_cua_type");
	});
});

describe("#given type tool #when executed #then computer type receives text", () => {
	it("types the requested text", async () => {
		const typeText = vi.fn<MacOSHostComputer["type"]>().mockResolvedValue(undefined);
		const computer = { type: typeText } as Pick<MacOSHostComputer, "type"> as MacOSHostComputer;
		const tool = createTypeTool(computer);

		await tool.execute("tool-call", { text: "hello" }, undefined, undefined, {} as ExtensionContext);

		expect(typeText).toHaveBeenCalledWith("hello");
	});
});
