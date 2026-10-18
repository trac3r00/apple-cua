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

function inputEffects(effects: readonly Effect[]): readonly Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}

describe("drag #given a screenshot-local path #when dispatched #then every point and button reach core", () => {
	it("converts the endpoints and waypoints to global coordinates", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const waypoints = [
			{ x: 100, y: 50 },
			{ x: 200, y: 150 },
		];

		const result = await harness.client.callTool({
			name: "drag",
			arguments: {
				app: "Finder",
				observation_token: token,
				from_x: 0,
				from_y: 0,
				to_x: 250,
				to_y: 200,
				waypoints,
				mouse_button: "middle",
				duration_ms: 1_250,
			},
		});

		expect(result.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([
			{
				kind: "drag",
				options: {
					from: { x: 300, y: 150 },
					waypoints: [
						{ x: 500, y: 250 },
						{ x: 700, y: 450 },
					],
					to: { x: 800, y: 550 },
					button: "middle",
					duration: 1_250,
				},
			},
		]);
	});

	it.each([30_001, -1, Number.POSITIVE_INFINITY, Number.NaN, 1.5])(
		"rejects invalid duration %s before dispatch",
		async (duration_ms) => {
			const harness = await createHarness();
			closeHarness = harness.close;
			const token = await observe(harness);

			const result = await harness.client.callTool({
				name: "drag",
				arguments: {
					app: "Finder",
					observation_token: token,
					from_x: 0,
					from_y: 0,
					to_x: 250,
					to_y: 200,
					duration_ms,
				},
			});

			expect(result.isError).toBe(true);
			expect(inputEffects(harness.computer.effects)).toEqual([]);
			expect(harness.computer.preflightExpected).toEqual([]);
		},
	);

	it("rejects an out-of-bounds waypoint before input preflight or dispatch", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "drag",
			arguments: {
				app: "Finder",
				observation_token: token,
				from_x: 0,
				from_y: 0,
				to_x: 250,
				to_y: 200,
				waypoints: [{ x: 500, y: 10 }],
			},
		});

		expect(result.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
		expect(harness.computer.preflightExpected).toEqual([]);
	});
});

describe("run_steps drag #given a bounded waypoint list #when dispatched #then it uses the same drag contract", () => {
	it("dispatches converted waypoints and the selected mouse button", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const waypoints = [{ x: 100, y: 50 }];

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{
						type: "drag",
						from_x: 0,
						from_y: 0,
						to_x: 250,
						to_y: 200,
						waypoints,
						mouse_button: "right",
						duration_ms: 2_000,
					},
				],
			},
		});

		expect(result.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toContainEqual({
			kind: "drag",
			options: {
				from: { x: 300, y: 150 },
				waypoints: [{ x: 500, y: 250 }],
				to: { x: 800, y: 550 },
				button: "right",
				duration: 2_000,
			},
		});
	});

	it("rejects an oversized duration in the batch before an earlier step dispatches", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "type_text", text: "must not dispatch" },
					{
						type: "drag",
						from_x: 0,
						from_y: 0,
						to_x: 250,
						to_y: 200,
						duration_ms: 30_001,
					},
				],
			},
		});

		expect(result.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("rejects malformed drag steps before an earlier valid step can dispatch", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "type_text", text: "must not dispatch" },
					{
						type: "drag",
						from_x: 0,
						from_y: 0,
						to_x: 250,
						to_y: 200,
						waypoints: Array.from({ length: 101 }, () => ({ x: 1, y: 1 })),
					},
				],
			},
		});

		expect(result.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("observation metadata #given display association in AppState #when serialized #then it remains available", () => {
	it("preserves the primary display, inventory, and observed window display ids", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const nativeState = harness.computer.getAppState;
		harness.computer.getAppState = async (...args) => ({
			...(await nativeState.apply(harness.computer, args)),
			display: { id: 7, isMain: true, x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 2 },
			displays: [{ id: 7, isMain: true, x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 2 }],
			windowDisplayId: 7,
			windowDisplayIds: [7],
		});

		const token = await observe(harness);
		const result = await harness.client.callTool({
			name: "get_app_state",
			arguments: { app: "Finder", observation_token: token },
		});
		const payload = jsonPayload(result);

		expect(payload).toMatchObject({
			display: { id: 7, isMain: true, x: 0, y: 0 },
			displays: [{ id: 7, isMain: true, x: 0, y: 0 }],
			windowDisplayId: 7,
			windowDisplayIds: [7],
		});

		const compactToken = await observe(harness);
		const mutation = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: compactToken, text: "metadata" },
		});
		expect(jsonPayload(mutation)).toMatchObject({
			display: { id: 7, isMain: true, x: 0, y: 0 },
			displays: [{ id: 7, isMain: true, x: 0, y: 0 }],
			windowDisplayId: 7,
			windowDisplayIds: [7],
		});
	});
});
