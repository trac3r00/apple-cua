import { describe, expect, it } from "vitest";
import { createHarness, observe } from "./protocol-client-harness.js";

describe("#given standard MCP discovery #when reading action schemas #then coordinates have JSON numeric types", () => {
	it("publishes numeric click and drag coordinates to generic harnesses", async () => {
		const harness = await createHarness();
		try {
			const result = await harness.client.listTools();
			for (const name of ["click", "drag"]) {
				const definition = result.tools.find((tool) => tool.name === name);
				const fields = name === "click" ? ["x", "y"] : ["from_x", "from_y", "to_x", "to_y"];
				for (const field of fields) {
					expect(definition?.inputSchema.properties?.[field]).toMatchObject({ type: "number" });
				}
			}
		} finally {
			await harness.close();
		}
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects non-JSON numeric coordinate %s without input",
		async (x) => {
			const harness = await createHarness();
			try {
				const token = await observe(harness);
				const result = await harness.client.callTool({
					name: "click",
					arguments: { app: "Finder", observation_token: token, x, y: 0 },
				});
				expect(result.isError).toBe(true);
				expect(harness.computer.effects).toEqual([]);
			} finally {
				await harness.close();
			}
		},
	);
});
