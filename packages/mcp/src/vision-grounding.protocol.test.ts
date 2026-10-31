import { describe, expect, it } from "bun:test";
import type { Point, PointerOptions } from "@apple-cua/core";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

class VisionOutcomeComputer extends FakeGuardedComputer {
	override async click(point: Point, options?: PointerOptions): Promise<void> {
		await super.click(point, options);
		// The fixture's row handler only responds to the actual global text centre.
		if (point.x === 520 && point.y === 490) {
			this.fieldValues.set(20, "selected row-03");
		}
	}
}

describe("#given OCR-only text in a scaled offset window #when targeted #then grounded input is verified", () => {
	it("dispatches to the observed PID and window and reads back the click outcome", async () => {
		const computer = new VisionOutcomeComputer();
		computer.delivery = "background";
		computer.axHidesRows = true;
		computer.scrollList = {
			rows: Array.from({ length: 8 }, (_, index) => `row-${String(index).padStart(2, "0")}`),
			visibleRows: 5,
			virtualized: true,
		};
		const harness = await createHarness(computer);
		try {
			const token = await observe(harness);
			const payload = jsonPayload(
				await harness.client.callTool({
					name: "run_steps",
					arguments: {
						app: "Finder",
						observation_token: token,
						steps: [{ type: "click", target: { text: "row-03" }, find: { vision: "only" } }],
						expect: { checks: [{ element_index: "20", value: "selected row-03" }] },
					},
				}),
			);

			expect(payload["runSteps"]).toMatchObject({
				completed: 1,
				steps: [
					{
						status: "dispatched",
						found: { found_by: "vision", matched_text: "row-03" },
					},
				],
			});
			expect(payload["verification"]).toMatchObject({ verified: true });
			expect(computer.targetedInputs).toEqual([
				{ effect: { kind: "click", point: { x: 520, y: 490 } }, pid: 1234, windowId: 71 },
			]);
			expect(computer.effects.some((effect) => effect.kind === "setValue")).toBe(false);
		} finally {
			await harness.close();
		}
	});

	it("refuses a semantic value write when only pixels identify the target", async () => {
		const computer = new FakeGuardedComputer();
		computer.axHidesRows = true;
		computer.scrollList = { rows: ["Only pixels"], visibleRows: 1, virtualized: true };
		const harness = await createHarness(computer);
		try {
			const token = await observe(harness);
			const payload = jsonPayload(
				await harness.client.callTool({
					name: "run_steps",
					arguments: {
						app: "Finder",
						observation_token: token,
						steps: [
							{ type: "set_value", target: { text: "Only pixels" }, value: "changed", find: { vision: "only" } },
						],
					},
				}),
			);

			expect(payload["runSteps"]).toMatchObject({ completed: 0, stoppedEarly: true });
			expect(computer.targetedInputs).toEqual([]);
			expect(computer.effects.some((effect) => effect.kind === "setValue")).toBe(false);
		} finally {
			await harness.close();
		}
	});
});
