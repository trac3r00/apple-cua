import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

describe("window targeting #given an app with several windows #when the agent picks one #then the observation is scoped to it", () => {
	it("exposes window_id on get_app_state", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const tools = await harness.client.listTools();
		const schema = tools.tools.find((tool) => tool.name === "get_app_state")?.inputSchema;

		expect(Object.keys(schema?.properties ?? {})).toContain("window_id");
	});

	it("passes the requested window id through to the computer", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "get_app_state",
			arguments: { app: "Finder", window_id: 38580 },
		});

		expect(result.isError).toBeFalsy();
		expect(harness.computer.stateOptions.at(-1)).toMatchObject({ windowId: 38580 });
		expect(jsonPayload(result)["observation_token"]).toBeTypeOf("string");
	});
});
