import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, jsonText, observe } from "./protocol-client-harness.js";
import type { Effect } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

function inputEffects(effects: readonly Effect[]): readonly Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}

describe("observe, batch, and verify #given any protocol client #when a workflow continues #then evidence and tokens stay compatible", () => {
	it.each([
		["client without elicitation", false],
		["client with elicitation", true],
	] as const)("runs a verified field workflow for a %s", async (_clientKind, canElicit) => {
		const onElicit = (_request: ElicitRequest): ElicitResult => ({
			action: "accept",
			content: { answer: "continue" },
		});
		const harness = await createHarness(
			undefined,
			undefined,
			undefined,
			canElicit ? { capabilities: { elicitation: {} }, onElicit } : undefined,
		);
		closeHarness = harness.close;

		const initial = jsonPayload(
			await harness.client.callTool({
				name: "get_app_state",
				arguments: { app: "Finder" },
			}),
		);
		const initialToken = initial["observation_token"];
		expect(typeof initialToken).toBe("string");

		const batch = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: initialToken,
				steps: [
					{ type: "set_value", element_index: "20", value: "ready" },
					{ type: "set_value", element_index: "21", value: "sent" },
				],
			},
		});
		const batchPayload = jsonPayload(batch);
		const continuation = batchPayload["observation_token"];

		expect(batch.isError).not.toBe(true);
		expect(batchPayload["runSteps"]).toMatchObject({ completed: 2, stoppedEarly: false });
		expect(typeof continuation).toBe("string");
		expect(continuation).not.toBe(initialToken);
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "ready" },
			{ kind: "setValue", pid: 1234, id: 21, value: "sent" },
		]);

		const verifiedResult = await harness.client.callTool({
			name: "verify_state",
			arguments: {
				app: "Finder",
				observation_token: continuation,
				checks: [
					{ element_index: "20", value: "ready" },
					{ element_index: "21", value: "sent" },
				],
			},
		});
		const verified = jsonPayload(verifiedResult);
		expect(verifiedResult.isError).not.toBe(true);
		expect(verified).toMatchObject({
			verified: true,
			checks: [
				{ verified: true, actual: 'value "ready"' },
				{ verified: true, actual: 'value "sent"' },
			],
		});
		expect(typeof verified["observation_token"]).toBe("string");
		expect(verified["observation_token"]).not.toBe(continuation);

		const stale = await harness.client.callTool({
			name: "set_value",
			arguments: {
				app: "Finder",
				observation_token: continuation,
				element_index: "20",
				value: "duplicate",
			},
		});
		expect(stale.isError).toBe(true);
		expect(jsonPayload(stale)).toMatchObject({
			reason: "stale-observation-token",
			actionDispatched: false,
		});
		expect(inputEffects(harness.computer.effects)).toHaveLength(2);

		const humanResult = await harness.client.callTool({
			name: "ask_user",
			arguments: { question: "Continue?", allow_free_text: true },
		});
		expect(humanResult.isError).not.toBe(true);
		if (canElicit) {
			expect(jsonPayload(humanResult)).toEqual({ answered: true, action: "accept", answer: "continue" });
		} else {
			expect(jsonPayload(humanResult)).toMatchObject({
				needs_user: true,
				question: "Continue?",
				instruction: expect.any(String),
			});
		}
		expect(jsonText(humanResult)).toContain(JSON.stringify(jsonPayload(humanResult)));
	});
});

describe("failed batch recovery #given a dispatched prefix #when the next step fails #then recovery does not repeat the prefix", () => {
	it("uses the returned fresh token to verify progress and continue once", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const failedBatch = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "set_value", element_index: "20", value: "saved" },
					{ type: "press_keys", keys: ["bogus+key"] },
					{ type: "set_value", element_index: "21", value: "never" },
				],
			},
		});
		const failedPayload = jsonPayload(failedBatch);
		const recoveryToken = failedPayload["observation_token"];

		expect(failedBatch.isError).not.toBe(true);
		expect(failedPayload["runSteps"]).toMatchObject({
			requested: 3,
			completed: 1,
			stoppedEarly: true,
			steps: [
				{ step: 0, status: "dispatched", input_dispatched: true },
				{ step: 1, status: "failed", input_dispatched: false },
			],
		});
		expect(typeof recoveryToken).toBe("string");
		expect(recoveryToken).not.toBe(token);
		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 20, value: "saved" }]);

		const verification = await harness.client.callTool({
			name: "verify_state",
			arguments: {
				app: "Finder",
				observation_token: recoveryToken,
				checks: [{ element_index: "20", value: "saved" }],
			},
		});
		const verified = jsonPayload(verification);
		expect(verified).toMatchObject({ verified: true, checks: [{ verified: true, actual: 'value "saved"' }] });

		const continued = await harness.client.callTool({
			name: "set_value",
			arguments: {
				app: "Finder",
				observation_token: verified["observation_token"],
				element_index: "21",
				value: "continued",
			},
		});
		expect(continued.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "saved" },
			{ kind: "setValue", pid: 1234, id: 21, value: "continued" },
		]);
	});
});
