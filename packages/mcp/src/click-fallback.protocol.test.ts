import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("#given a control that rejects AXPress #when it is clicked by element id #then the click falls back to its centre instead of failing", () => {
	it("clicks the element centre through the pointer route and reports the fallback", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.performActionError = new Error("AXUIElementPerformAction failed with AXError -25206");
		harness.computer.elementFrames.set(9, { x: 100, y: 200, width: 40, height: 20 });
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({ kind: "click", point: { x: 120, y: 210 } });
		expect(jsonPayload(result)).toMatchObject({
			actionDispatched: true,
			route: "synthetic_events",
			fallback: { from: "accessibility", reason: "AXUIElementPerformAction failed with AXError -25206" },
		});
	});
});

describe("#given a click #when preflight runs #then only screen-coordinate input requires unchanged window bounds", () => {
	it.each([
		[{ element_index: "9" }, false],
		[{ x: 10, y: 10 }, true],
	])("click %o requires same bounds: %s", async (target, requireSameBounds) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, ...target },
		});

		expect(harness.computer.preflightOptions.at(-1)).toEqual({ requireSameBounds });
	});
});

describe("#given an element id that no longer names the observed control #when it is clicked #then nothing falls back", () => {
	it("refuses without clicking anywhere", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.performActionError = new Error("element 9 is now AXRow, not the observed control");
		harness.computer.elementFrames.set(9, { x: 100, y: 200, width: 40, height: 20 });
		const token = await observe(harness);

		await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(harness.computer.effects.some((effect) => effect.kind === "click")).toBe(false);
	});
});
