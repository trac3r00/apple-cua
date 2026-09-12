import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import type { Effect } from "./protocol-test-harness.js";

const cases: readonly {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
	readonly expected: Effect;
}[] = [
	{
		name: "click",
		arguments: { app: "Finder", element_index: "9" },
		expected: { kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
	},
	{
		name: "click",
		arguments: { app: "Finder", x: 250, y: 200 },
		expected: { kind: "click", point: { x: 800, y: 550 } },
	},
	{
		name: "perform_secondary_action",
		arguments: { app: "Finder", element_index: "9", action: "AXShowMenu" },
		expected: { kind: "performAction", pid: 1234, id: 9, action: "AXShowMenu" },
	},
	{
		name: "set_value",
		arguments: { app: "Finder", element_index: "9", value: "abc" },
		expected: { kind: "setValue", pid: 1234, id: 9, value: "abc" },
	},
	{
		name: "select_text",
		arguments: { app: "Finder", element_index: "9", text: "abc" },
		expected: { kind: "selectText", pid: 1234, id: 9 },
	},
	{
		name: "drag",
		arguments: { app: "Finder", from_x: 0, from_y: 0, to_x: 250, to_y: 200 },
		expected: { kind: "drag", options: { from: { x: 300, y: 150 }, to: { x: 800, y: 550 } } },
	},
	{
		name: "scroll",
		arguments: { app: "Finder", element_index: "9", direction: "down" },
		expected: { kind: "performAction", pid: 1234, id: 9, action: "AXScrollDownByPage" },
	},
	{
		name: "type_text",
		arguments: { app: "Finder", text: "hello" },
		expected: { kind: "type", text: "hello" },
	},
	{
		name: "press_keys",
		arguments: { app: "Finder", keys: ["super+k"] },
		expected: { kind: "key", key: "k" },
	},
];

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("mutation routing #given every mutation tool #when token state varies #then dispatch requires one observed token", () => {
	it.each(cases)("guards and routes $name", async (testCase) => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const missing = await harness.client.callTool({ name: testCase.name, arguments: testCase.arguments });
		const unobserved = await harness.client.callTool({
			name: testCase.name,
			arguments: { ...testCase.arguments, observation_token: "not-issued" },
		});
		expect(missing.isError).toBe(true);
		expect(unobserved.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);

		const token = await observe(harness);
		const accepted = await harness.client.callTool({
			name: testCase.name,
			arguments: { ...testCase.arguments, observation_token: token },
		});
		const payload = jsonPayload(accepted);

		expect(accepted.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([testCase.expected]);
		expect(payload).toMatchObject({
			actionDispatched: true,
			observationStatus: "changed",
			paused: false,
			needsExplicitObservation: false,
		});
		expect(payload["observation_token"]).toEqual(expect.any(String));
		expect(harness.computer.stateOptions.at(-1)).toEqual({ requireWindow: true });

		const replay = await harness.client.callTool({
			name: testCase.name,
			arguments: { ...testCase.arguments, observation_token: token },
		});
		expect(replay.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([testCase.expected]);
	});
});

describe("target validation #given a token observation #when ids, coordinates, or app differ #then input is rejected", () => {
	it.each([
		{ name: "click", arguments: { app: "Finder", element_index: "10" } },
		{ name: "set_value", arguments: { app: "Finder", element_index: "10", value: "x" } },
		{ name: "perform_secondary_action", arguments: { app: "Finder", element_index: "10", action: "AXShowMenu" } },
		{ name: "select_text", arguments: { app: "Finder", element_index: "10", text: "x" } },
		{ name: "scroll", arguments: { app: "Finder", element_index: "10", direction: "down" } },
		{ name: "click", arguments: { app: "Finder", x: 500, y: 0 } },
		{ name: "click", arguments: { app: "Finder", x: -1, y: 0 } },
		{ name: "click", arguments: { app: "Finder", x: 0, y: -1 } },
		{ name: "drag", arguments: { app: "Finder", from_x: 0, from_y: 0, to_x: 0, to_y: 400 } },
	])("rejects invalid target for $name", async (testCase) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: testCase.name,
			arguments: { ...testCase.arguments, observation_token: token },
		});
		const replay = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "must not dispatch" },
		});

		expect(result.isError).toBe(true);
		expect(replay.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
		expect(harness.computer.preflightExpected).toEqual([]);
	});

	it("accepts the last in-bounds coordinate and maps only through the captured viewport", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, x: 499, y: 399 },
		});

		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "click", point: { x: 1298, y: 948 } }]);
	});

	it("consumes a valid token before rejecting an app mismatch", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const mismatch = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Other", observation_token: token, text: "wrong target" },
		});
		const replay = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "replay" },
		});

		expect(mismatch.isError).toBe(true);
		expect(replay.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("native preflight #given recorded metadata #when policy revokes input #then metadata is preserved and no action occurs", () => {
	it("passes the immutable observation unchanged and rejects revocation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const before = harness.computer.getInputObservation(1234);
		harness.computer.preflightResult = { ok: false, reason: "app-not-approved" };

		const result = await harness.client.callTool({
			name: "press_keys",
			arguments: { app: "Finder", observation_token: token, keys: ["Return"] },
		});

		expect(result.isError).toBe(true);
		expect(harness.computer.preflightExpected).toEqual([before]);
		expect(harness.computer.getInputObservation(1234)).toBe(before);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

function inputEffects(effects: readonly Effect[]): readonly Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}
