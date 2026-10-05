import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("observe_apps #given two approved apps #when both are observed in one call #then each answers with its own token", () => {
	it("returns one entry per app, text-only by default", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({ name: "observe_apps", arguments: { apps: ["Finder", "Other"] } });

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			apps: [
				{ app: "Finder", ok: true, result: { observation_token: expect.any(String) } },
				{ app: "Other", ok: true, result: { observation_token: expect.any(String) } },
			],
		});
		expect(harness.computer.stateOptions.every((options) => options?.includeScreenshot === false)).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			apps: [{ result: { element_rows: expect.any(Array) } }, { result: { element_rows: expect.any(Array) } }],
		});
	});
});

describe("run_parallel #given batches for two apps #when they run in one call #then both apps are driven", () => {
	it("dispatches each batch to its own app and answers per batch", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.delivery = "background";
		const finderToken = await observe(harness, "Finder");
		const otherToken = await observe(harness, "Other");

		const result = await harness.client.callTool({
			name: "run_parallel",
			arguments: {
				batches: [
					{
						app: "Finder",
						observation_token: finderToken,
						steps: [{ type: "set_value", element_index: "20", value: "f" }],
					},
					{
						app: "Other",
						observation_token: otherToken,
						steps: [{ type: "set_value", element_index: "20", value: "o" }],
					},
				],
			},
		});

		expect(harness.computer.effects).toContainEqual({ kind: "setValue", pid: 1234, id: 20, value: "f" });
		expect(harness.computer.effects).toContainEqual({ kind: "setValue", pid: 5678, id: 20, value: "o" });
		expect(jsonPayload(result)).toMatchObject({
			batches: [
				{ app: "Finder", ok: true, result: { runSteps: { completed: 1 } } },
				{ app: "Other", ok: true, result: { runSteps: { completed: 1 } } },
			],
		});
	});

	it("reports a batch with a stale token without stopping the other", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.delivery = "background";
		const finderToken = await observe(harness, "Finder");

		const result = await harness.client.callTool({
			name: "run_parallel",
			arguments: {
				batches: [
					{
						app: "Finder",
						observation_token: finderToken,
						steps: [{ type: "set_value", element_index: "20", value: "f" }],
					},
					{ app: "Other", observation_token: "not-a-token", steps: [{ type: "type_text", text: "never" }] },
				],
			},
		});

		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({ kind: "setValue", pid: 1234, id: 20, value: "f" });
		expect(harness.computer.effects.some((effect) => effect.kind === "type")).toBe(false);
		expect(jsonPayload(result)).toMatchObject({
			batches: [
				{ app: "Finder", ok: true },
				{ app: "Other", ok: false },
			],
		});
	});

	it("refuses two batches for the same app", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness, "Finder");

		const result = await harness.client.callTool({
			name: "run_parallel",
			arguments: {
				batches: [
					{ app: "Finder", observation_token: token, steps: [{ type: "type_text", text: "a" }] },
					{ app: "Finder", observation_token: token, steps: [{ type: "type_text", text: "b" }] },
				],
			},
		});

		expect(result.isError).toBe(true);
		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([]);
	});
});
