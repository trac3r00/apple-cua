import type { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "../pi/index.js";
import { createKeyTool } from "./key.js";

describe("#given key tool factory #when built #then tool name is prefixed", () => {
	it("returns macos_cua_key", () => {
		const computer = { key: vi.fn() } as Pick<MacOSHostComputer, "key"> as MacOSHostComputer;
		const tool = createKeyTool(computer);

		expect(tool.name).toBe("macos_cua_key");
	});
});

describe("#given key tool #when executed #then computer key receives normalized modifiers", () => {
	it("presses the requested key chord", async () => {
		const key = vi.fn<MacOSHostComputer["key"]>().mockResolvedValue(undefined);
		const computer = { key } as Pick<MacOSHostComputer, "key"> as MacOSHostComputer;
		const tool = createKeyTool(computer);

		await tool.execute(
			"tool-call",
			{ key: "s", modifiers: ["cmd", "shift"] },
			undefined,
			undefined,
			{} as ExtensionContext,
		);

		expect(key).toHaveBeenCalledWith("s", { modifiers: ["command", "shift"] });
	});
});
