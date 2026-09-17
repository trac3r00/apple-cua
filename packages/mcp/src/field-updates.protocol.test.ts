import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import type { Effect } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("set_fields #given observed text fields #when several values change #then each update is verified against a fresh read", () => {
	it("applies both updates and reports verified values", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: {
				app: "Finder",
				observation_token: token,
				updates: [
					{ element_index: "20", value: "alpha" },
					{ element_index: "21", value: "beta" },
				],
			},
		});
		const payload = jsonPayload(result);

		expect(result.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "alpha" },
			{ kind: "setValue", pid: 1234, id: 21, value: "beta" },
		]);
		expect(payload["setFields"]).toMatchObject({
			requested: 2,
			inputDispatched: 2,
			verified: 2,
			outcomeVerified: true,
			stoppedEarly: false,
			uiChanged: true,
			steps: [
				{
					element_index: 20,
					requested_value: "alpha",
					input_dispatched: true,
					observed_value: "alpha",
					status: "verified",
				},
				{
					element_index: 21,
					requested_value: "beta",
					input_dispatched: true,
					observed_value: "beta",
					status: "verified",
				},
			],
		});
		expect(payload["observation_token"]).toEqual(expect.any(String));
	});

	it("reads each field back through a fresh, non-diff observation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		await harness.client.callTool({
			name: "set_fields",
			arguments: { app: "Finder", observation_token: token, updates: [{ element_index: "20", value: "alpha" }] },
		});

		const verifyReads = harness.computer.stateOptions.filter(
			(options) => options?.settleMs !== undefined && options.requireWindow === true,
		);
		expect(verifyReads.length).toBeGreaterThanOrEqual(2);
		expect(harness.computer.stateOptions.at(-1)).toEqual({
			diffOnly: true,
			requireWindow: true,
			includeScreenshot: false,
		});
	});
});

describe("set_fields #given an app that does not apply the write #when reading back #then it stops with partial progress", () => {
	it("reports the unverified field and dispatches no further input", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.valueWriteEffect = "ignore";

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: {
				app: "Finder",
				observation_token: token,
				updates: [
					{ element_index: "20", value: "alpha" },
					{ element_index: "21", value: "beta" },
				],
			},
		});
		const payload = jsonPayload(result);

		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 20, value: "alpha" }]);
		expect(payload["setFields"]).toMatchObject({
			requested: 2,
			inputDispatched: 1,
			verified: 0,
			outcomeVerified: false,
			stoppedEarly: true,
			steps: [
				{
					element_index: 20,
					input_dispatched: true,
					observed_value: "draft",
					status: "unverified",
					reason: expect.stringContaining("does not match"),
				},
			],
		});
	});
});

describe("set_fields #given stale element ids #when the tree moved on #then the request is refused instead of writing blind", () => {
	it("skips an element that vanished from the fresh observation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.hiddenElementIds.add(20);

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: { app: "Finder", observation_token: token, updates: [{ element_index: "20", value: "alpha" }] },
		});
		const payload = jsonPayload(result);

		expect(inputEffects(harness.computer.effects)).toEqual([]);
		expect(payload["setFields"]).toMatchObject({
			requested: 1,
			inputDispatched: 0,
			verified: 0,
			outcomeVerified: false,
			stoppedEarly: true,
			steps: [{ element_index: 20, status: "skipped", reason: expect.stringContaining("not present") }],
		});
	});

	it("skips an index whose control changed identity after the observation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.elementLabelOverrides.set(20, "Archived note");

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: { app: "Finder", observation_token: token, updates: [{ element_index: "20", value: "alpha" }] },
		});
		const payload = jsonPayload(result);

		expect(inputEffects(harness.computer.effects)).toEqual([]);
		expect(payload["setFields"]).toMatchObject({
			steps: [{ element_index: 20, status: "skipped", reason: expect.stringContaining("not the observed control") }],
		});
	});

	it("rejects an index that was never observed and consumes the token", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: { app: "Finder", observation_token: token, updates: [{ element_index: "10", value: "alpha" }] },
		});
		const replay = await harness.client.callTool({
			name: "set_fields",
			arguments: { app: "Finder", observation_token: token, updates: [{ element_index: "20", value: "alpha" }] },
		});

		expect(result.isError).toBe(true);
		expect(replay.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("rejects an unbounded update list before dispatching input", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: {
				app: "Finder",
				observation_token: token,
				updates: Array.from({ length: 11 }, (_, index) => ({ element_index: String(20 + index), value: "x" })),
			},
		});

		expect(result.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

function inputEffects(effects: readonly Effect[]): readonly Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}
