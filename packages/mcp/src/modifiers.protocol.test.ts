import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { clickSchema, dragSchema, runStepSchema, scrollSchema } from "./tool-schemas.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

const FRAME = { x: 100, y: 200, width: 40, height: 20 };
const CENTRE = { x: 120, y: 210 };

async function start() {
	const harness = await createHarness();
	closeHarness = harness.close;
	harness.computer.elementFrames.set(9, FRAME);
	const token = await observe(harness);
	return { harness, token };
}

describe("#given the click, drag and scroll schemas #when they carry modifiers #then names and aliases are accepted", () => {
	const base = { app: "Finder", observation_token: "t" };

	it.each(["command", "shift", "option", "control", "cmd", "alt", "opt", "ctrl"])("accepts %s", (modifier) => {
		expect(clickSchema.safeParse({ ...base, element_index: "9", modifiers: [modifier] }).success).toBe(true);
		expect(
			dragSchema.safeParse({ ...base, from_x: 1, from_y: 2, to_x: 3, to_y: 4, modifiers: [modifier] }).success,
		).toBe(true);
		expect(
			scrollSchema.safeParse({ ...base, direction: "down", element_index: "9", modifiers: [modifier] }).success,
		).toBe(true);
	});

	it("accepts modifiers on the click, drag and scroll steps of run_steps", () => {
		expect(runStepSchema.safeParse({ type: "click", element_index: "9", modifiers: ["cmd"] }).success).toBe(true);
		expect(
			runStepSchema.safeParse({ type: "drag", from_x: 1, from_y: 2, to_x: 3, to_y: 4, modifiers: ["alt"] }).success,
		).toBe(true);
		expect(
			runStepSchema.safeParse({ type: "scroll", direction: "up", element_index: "9", modifiers: ["shift"] }).success,
		).toBe(true);
	});

	it("rejects a modifier that is not one", () => {
		expect(clickSchema.safeParse({ ...base, element_index: "9", modifiers: ["hyper"] }).success).toBe(false);
		expect(runStepSchema.safeParse({ type: "click", element_index: "9", modifiers: "command" }).success).toBe(false);
	});

	it("keeps modifiers optional", () => {
		expect(clickSchema.safeParse({ ...base, element_index: "9" }).success).toBe(true);
	});
});

describe("#given an element click with modifiers #when it is dispatched #then it uses the pointer route with the flags", () => {
	it("clicks the element centre with normalized modifiers instead of pressing it", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "click",
			arguments: {
				app: "Finder",
				observation_token: token,
				element_index: "9",
				modifiers: ["cmd", "shift", "command"],
			},
		});

		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({
			kind: "click",
			point: CENTRE,
			modifiers: ["command", "shift"],
		});
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
		expect(jsonPayload(result)).toMatchObject({ actionDispatched: true, route: "synthetic_events" });
	});

	it("keeps the accessibility route for a click without modifiers", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(harness.computer.effects).toContainEqual({ kind: "performAction", pid: 1234, id: 9, action: "AXPress" });
		expect(harness.computer.effects.some((effect) => effect.kind === "click")).toBe(false);
		expect(jsonPayload(result)).toMatchObject({ route: "accessibility" });
	});

	it("does the same for a click step in run_steps", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [{ type: "click", element_index: "9", modifiers: ["command"] }],
			},
		});

		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({ kind: "click", point: CENTRE, modifiers: ["command"] });
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
		expect(JSON.stringify(jsonPayload(result))).toContain("synthetic_events");
	});

	it("clicks a screenshot point with modifiers through the pointer route as well", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, x: 10, y: 10, modifiers: ["shift"] },
		});

		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual(expect.objectContaining({ kind: "click", modifiers: ["shift"] }));
	});

	it("refuses an element with no on-screen frame instead of clicking elsewhere", async () => {
		const { harness, token } = await start();
		harness.computer.elementFrames.clear();

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9", modifiers: ["command"] },
		});

		expect(JSON.stringify(result)).toContain("no on-screen frame");
		expect(harness.computer.effects.some((effect) => effect.kind === "click")).toBe(false);
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});
});

describe("#given a drag with modifiers #when it is dispatched #then the drag carries them", () => {
	it("passes normalized modifiers through the drag tool and the drag step", async () => {
		const { harness, token } = await start();

		await harness.client.callTool({
			name: "drag",
			arguments: {
				app: "Finder",
				observation_token: token,
				from_x: 5,
				from_y: 5,
				to_x: 50,
				to_y: 50,
				modifiers: ["alt"],
			},
		});

		const drags = harness.computer.effects.filter((effect) => effect.kind === "drag");
		expect(drags).toHaveLength(1);
		expect(drags[0]).toMatchObject({ options: { modifiers: ["option"] } });
	});

	it("leaves a plain drag exactly as before", async () => {
		const { harness, token } = await start();

		await harness.client.callTool({
			name: "drag",
			arguments: { app: "Finder", observation_token: token, from_x: 5, from_y: 5, to_x: 50, to_y: 50 },
		});

		const drag = harness.computer.effects.find((effect) => effect.kind === "drag");
		expect(drag?.kind === "drag" && "modifiers" in drag.options).toBe(false);
	});
});

describe("#given a scroll with modifiers #when it is dispatched #then it is refused before anything is sent", () => {
	it("refuses with the reason instead of reporting a scroll that never happened", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "scroll",
			arguments: {
				app: "Finder",
				observation_token: token,
				element_index: "9",
				direction: "down",
				modifiers: ["shift"],
			},
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result)).toContain("scroll with modifiers is refused");
		expect(harness.computer.effects.some((effect) => effect.kind === "scroll")).toBe(false);
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("fails a run_steps scroll step with modifiers without dispatching it", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [{ type: "scroll", element_index: "9", direction: "down", modifiers: ["shift"] }],
			},
		});

		expect(JSON.stringify(result)).toContain("scroll with modifiers is refused");
		expect(harness.computer.effects.some((effect) => effect.kind === "scroll")).toBe(false);
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("keeps the accessibility page action for a scroll without modifiers", async () => {
		const { harness, token } = await start();

		const result = await harness.client.callTool({
			name: "scroll",
			arguments: { app: "Finder", observation_token: token, element_index: "9", direction: "down" },
		});

		expect(harness.computer.effects).toContainEqual({
			kind: "performAction",
			pid: 1234,
			id: 9,
			action: "AXScrollDownByPage",
		});
		expect(harness.computer.effects.some((effect) => effect.kind === "scroll")).toBe(false);
		expect(jsonPayload(result)).toMatchObject({ route: "accessibility" });
	});
});
