import { afterEach, describe, expect, it } from "bun:test";
import { createHarness, jsonPayload, jsonText, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function imageBlocks(result: unknown): readonly unknown[] {
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		throw new Error("tool result content must be an array");
	}
	return result.content.filter(
		(item: unknown) => typeof item === "object" && item !== null && "type" in item && item.type === "image",
	);
}

describe("set_value #given an observed field #when writing #then the result includes value readback", () => {
	it.each([
		{ write: "apply" as const, actual: "ready", verified: true },
		{ write: "ignore" as const, actual: "draft", verified: false },
	])("reports verified=$verified when the app chooses to $write the write", async ({ write, actual, verified }) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.valueWriteEffect = write;

		const result = await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: token, element_index: "20", value: "ready" },
		});
		const payload = jsonPayload(result);

		expect(payload["setValue"]).toEqual({
			element_index: 20,
			requested_value: "ready",
			observed_value: actual,
			verified,
		});
		expect(payload["actionDispatched"]).toBe(true);
		expect(payload["observation_token"]).toEqual(expect.any(String));
		if (verified) {
			expect(payload["effect"]).toBe("confirmed");
			expect(payload["evidence"]).toContainEqual({ kind: "value_readback" });
		}
	});
});

describe("tool failures #given an empty native exception #when set_value fails #then the client receives a useful error", () => {
	it.each(["", " \n\t"])("returns nonblank error text for %j without replaying input", async (message) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.inputError = new Error(message);

		const result = await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: token, element_index: "20", value: "ready" },
		});

		expect(result.isError).toBe(true);
		expect(jsonText(result).trim().length).toBeGreaterThan(0);
		expect(await observe(harness)).toEqual(expect.any(String));
		expect(harness.computer.effects.filter((effect) => effect.kind === "setValue")).toEqual([]);
	});

	it("reports a failed readback without losing the dispatched-write status", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.stateError = new Error("");

		const result = await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: token, element_index: "20", value: "ready" },
		});
		const payload = jsonPayload(result);

		expect(payload).toMatchObject({ actionDispatched: true, paused: true, needsExplicitObservation: true });
		expect(payload).not.toHaveProperty("observation_token");
		const error = payload["error"];
		expect(typeof error === "string" && error.trim().length > 0).toBe(true);
		expect(harness.computer.effects.filter((effect) => effect.kind === "setValue")).toHaveLength(1);
		expect(await observe(harness)).toEqual(expect.any(String));
	});
});

describe("action result payload #given a dispatched action #when the caller does not ask for the image #then the answer stays text-only", () => {
	it("omits the post-action screenshot by default and returns it only on request", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const leanToken = await observe(harness);
		const lean = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: leanToken, element_index: "9" },
		});

		const optedInToken = await observe(harness);
		const withImage = await harness.client.callTool({
			name: "click",
			arguments: {
				app: "Finder",
				observation_token: optedInToken,
				element_index: "9",
				include_screenshot: true,
			},
		});

		expect(imageBlocks(lean)).toHaveLength(0);
		expect(jsonPayload(lean)).toMatchObject({ actionDispatched: true });
		expect(imageBlocks(withImage)).toHaveLength(1);
	});
});
