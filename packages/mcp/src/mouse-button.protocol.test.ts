import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

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

describe("#given an element click with a non-left mouse button #when it is dispatched #then it never presses the element", () => {
	it("right-clicks the element centre through the pointer route instead of AXPress", async () => {
		const { harness, token } = await start();
		const rightClick = vi.spyOn(harness.computer, "rightClick");

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9", mouse_button: "right" },
		});

		expect(result.isError).not.toBe(true);
		expect(rightClick).toHaveBeenCalledTimes(1);
		expect(rightClick.mock.calls[0]?.[0]).toEqual(CENTRE);
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
		expect(jsonPayload(result)).toMatchObject({ route: "synthetic_events" });
	});

	it("middle-clicks the element centre through the pointer route instead of AXPress", async () => {
		const { harness, token } = await start();
		const middleClick = vi.spyOn(harness.computer, "middleClick");

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9", mouse_button: "middle" },
		});

		expect(result.isError).not.toBe(true);
		expect(middleClick).toHaveBeenCalledTimes(1);
		expect(middleClick.mock.calls[0]?.[0]).toEqual(CENTRE);
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("does the same for a click step in run_steps", async () => {
		const { harness, token } = await start();
		const rightClick = vi.spyOn(harness.computer, "rightClick");

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [{ type: "click", element_index: "9", mouse_button: "right" }],
			},
		});

		expect(result.isError).not.toBe(true);
		expect(rightClick).toHaveBeenCalledTimes(1);
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("refuses an element with no on-screen frame instead of pressing it", async () => {
		const { harness, token } = await start();
		harness.computer.elementFrames.clear();

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9", mouse_button: "right" },
		});

		expect(JSON.stringify(result)).toContain("no on-screen frame");
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
		expect(harness.computer.effects.some((effect) => effect.kind === "click")).toBe(false);
	});

	it("still presses the element for a plain left click", async () => {
		const { harness, token } = await start();

		await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9", mouse_button: "left" },
		});

		expect(harness.computer.effects).toContainEqual({ kind: "performAction", pid: 1234, id: 9, action: "AXPress" });
	});
});
