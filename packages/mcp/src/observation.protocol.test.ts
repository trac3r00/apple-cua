import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("post-action observation #given dispatched input #when capture outcome varies #then continuation pauses honestly", () => {
	it.each([
		{ summary: { added: 0, removed: 0, changed: 0 }, expected: "unchanged" },
		{ summary: undefined, expected: "unavailable" },
	])(
		"pauses without a token when AX status is $expected and explicit observation recovers",
		async ({ summary, expected }) => {
			const harness = await createHarness();
			closeHarness = harness.close;
			harness.computer.postActionSummary = summary;
			const token = await observe(harness);

			const action = await harness.client.callTool({
				name: "set_value",
				arguments: { app: "Finder", observation_token: token, element_index: "9", value: "abc" },
			});
			const payload = jsonPayload(action);
			const replay = await harness.client.callTool({
				name: "set_value",
				arguments: { app: "Finder", observation_token: token, element_index: "9", value: "replay" },
			});
			const recoveredToken = await observe(harness);

			expect(payload).toMatchObject({
				actionDispatched: true,
				observationStatus: expected,
				paused: true,
				needsExplicitObservation: true,
			});
			expect(payload).not.toHaveProperty("observation_token");
			expect(replay.isError).toBe(true);
			expect(typeof recoveredToken).toBe("string");
		},
	);

	it("pauses when post-action context changes even if the AX tree changed", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.windowIdAfterAction = 72;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "press_keys",
			arguments: { app: "Finder", observation_token: token, keys: ["Return"] },
		});
		const payload = jsonPayload(result);

		expect(payload).toMatchObject({
			observationStatus: "context-changed",
			paused: true,
			needsExplicitObservation: true,
		});
		expect(payload).not.toHaveProperty("observation_token");
	});

	it("returns a machine-readable paused error when strict post-read fails, then permits explicit recovery", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.stateError = new Error("window capture failed");

		const result = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "sent" },
		});
		const payload = jsonPayload(result);
		const stale = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "again" },
		});
		const recoveredToken = await observe(harness);

		expect(payload).toEqual({
			actionDispatched: true,
			observationStatus: "error",
			paused: true,
			needsExplicitObservation: true,
			error: "window capture failed",
		});
		expect(stale.isError).toBe(true);
		expect(typeof recoveredToken).toBe("string");
	});

	it("does not mint a token after an input error or retry the input", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.inputError = new Error("input dispatch failed");

		const failed = await harness.client.callTool({
			name: "press_keys",
			arguments: { app: "Finder", observation_token: token, keys: ["Return"] },
		});
		const replay = await harness.client.callTool({
			name: "press_keys",
			arguments: { app: "Finder", observation_token: token, keys: ["Return"] },
		});

		expect(failed.isError).toBe(true);
		expect(replay.isError).toBe(true);
		expect(harness.computer.effects.filter((effect) => effect.kind === "key")).toEqual([]);
		expect(harness.computer.stateOptions).toHaveLength(1);
	});
});

describe("strict explicit observation #given no visible capture #when get_app_state fails #then no token exists", () => {
	it("denies subsequent input and records requireWindow", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.stateError = new Error("window missing");

		const observation = await harness.client.callTool({ name: "get_app_state", arguments: { app: "Finder" } });
		const mutation = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: "invented", x: 1, y: 1 },
		});

		expect(observation.isError).toBe(true);
		expect(mutation.isError).toBe(true);
		expect(harness.computer.stateOptions).toEqual([{ requireWindow: true }]);
		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([]);
	});

	it("keeps diff_only opt-in while requiring a target window", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const first = await harness.client.callTool({
			name: "get_app_state",
			arguments: { app: "Finder", diff_only: false },
		});
		const second = await harness.client.callTool({
			name: "get_app_state",
			arguments: { app: "Finder", diff_only: true },
		});

		expect(jsonPayload(first)["elements"]).toEqual(expect.any(Array));
		expect(harness.computer.stateOptions).toEqual([{ requireWindow: true }, { diffOnly: true, requireWindow: true }]);
		expect(jsonPayload(second)["observation_token"]).toEqual(expect.any(String));
	});
});
