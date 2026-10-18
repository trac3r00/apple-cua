import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

describe("#given a guarded drag #when duration is supplied #then milliseconds reach the input driver", () => {
	it.each(["drag", "run_steps"])("forwards duration_ms through %s", async (name) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const fields = { from_x: 5, from_y: 5, to_x: 50, to_y: 50, duration_ms: 240, modifiers: ["alt"] };
		const result = await harness.client.callTool({
			name,
			arguments: {
				app: "Finder",
				observation_token: token,
				...(name === "drag" ? fields : { steps: [{ type: "drag", ...fields }] }),
			},
		});
		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({
			kind: "drag",
			options: {
				from: { x: 310, y: 160 },
				to: { x: 400, y: 250 },
				duration: 240,
				modifiers: ["option"],
			},
		});
	});

	it("builds guarded script drags and batch steps from screenshot points", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const result = await harness.client.callTool({
			name: "run_script",
			arguments: {
				code: `
					const finder = apple.app("Finder");
					await finder.observe();
					await finder.drag({x:5,y:5},{x:50,y:50},{durationMs:240,modifiers:["alt"]});
					await finder.batch([apple.steps.drag({x:5,y:5},{x:50,y:50},{durationMs:0})]);
					return "dragged";
				`,
			},
		});
		expect(jsonPayload(result)).toMatchObject({ ok: true, value: "dragged" });
		const drags = harness.computer.effects.filter((effect) => effect.kind === "drag");
		expect(drags).toHaveLength(2);
		expect(drags[0]).toMatchObject({ options: { duration: 240, modifiers: ["option"] } });
		expect(drags[1]).toMatchObject({ options: { duration: 0 } });
	});

	it.each([
		"await finder.drag({x:5,y:5},{x:50,y:50})",
		"await finder.observe(); await finder.drag({x:5,y:5},{x:500,y:50})",
		"await finder.observe(); await finder.drag({x:5,y:5},{x:50,y:50},{durationMs:-1})",
	])("refuses unobserved, out-of-bounds, or invalid drags: %s", async (code) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const result = await harness.client.callTool({
			name: "run_script",
			arguments: { code: `const finder = apple.app("Finder"); ${code};` },
		});
		expect(jsonPayload(result)).toMatchObject({ ok: false });
		expect(harness.computer.effects).toHaveLength(0);
	});
});
