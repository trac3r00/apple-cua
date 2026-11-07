import { afterEach, describe, expect, it } from "bun:test";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function webComputer(webIds: readonly number[] = [9]) {
	const computer = new FakeGuardedComputer();
	computer.delivery = "background";
	computer.elementFrames.set(9, { x: 320, y: 190, width: 60, height: 80 });
	computer.elementFrames.set(20, { x: 320, y: 190, width: 60, height: 80 });
	return Object.assign(computer, {
		async pressAtPosition(): Promise<boolean> {
			return true;
		},
		async isWebElement(_pid: number, id: number): Promise<boolean> {
			return webIds.includes(id);
		},
	});
}

describe("#given a background web element #when click uses its observed id #then it routes through pointer input", () => {
	it("does not dispatch AXPress or the accessibility point hit test", async () => {
		const computer = webComputer();
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});
		const payload = jsonPayload(result);

		expect(payload).toMatchObject({ route: "synthetic_events", delivery: "background" });
		expect(computer.effects).toContainEqual({ kind: "click", point: { x: 350, y: 230 } });
		expect(computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("uses the ancestry result for fields, checkboxes, and links independent of the app name", async () => {
		const computer = webComputer([20, 22, 23]);
		computer.extraElements.push(
			{
				id: 22,
				role: "AXCheckBox",
				label: "Remember",
				value: null,
				frame: { x: 10, y: 20, width: 30, height: 40 },
				actions: ["AXPress"],
				children: [],
			},
			{
				id: 23,
				role: "AXLink",
				label: "Help",
				value: null,
				frame: { x: 10, y: 20, width: 30, height: 40 },
				actions: ["AXPress"],
				children: [],
			},
		);
		for (const id of [20, 22, 23]) {
			computer.elementFrames.set(id, { x: 320, y: 190, width: 60, height: 80 });
		}
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		for (const id of [20, 22, 23]) {
			const token = await observe(harness);
			const result = await harness.client.callTool({
				name: "click",
				arguments: { app: "Finder", observation_token: token, element_index: String(id) },
			});

			expect(result.isError).toBeFalsy();
			expect(computer.effects.at(-1)).toEqual({ kind: "click", point: { x: 350, y: 230 } });
		}
		expect(computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});
});

describe("#given a background web element #when click_target defaults to auto #then it uses the pointer route", () => {
	it("uses the control's current screen frame rather than stale snapshot coordinates", async () => {
		const computer = webComputer();
		computer.elementFrames.set(9, { x: 700, y: 350, width: 20, height: 20 });
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" } },
		});
		expect(result.isError).not.toBe(true);
		expect(computer.effects).toContainEqual({ kind: "click", point: { x: 710, y: 360 } });
	});

	it("chooses web ancestry before the advertised AXPress action", async () => {
		const computer = webComputer();
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" } },
		});

		expect(jsonPayload(result)).toMatchObject({ route: "synthetic_events", delivery: "background" });
		expect(computer.effects).toContainEqual({ kind: "click", point: { x: 350, y: 230 } });
		expect(computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});
});

describe("#given native or explicit routes #when click_target acts #then its requested semantics are preserved", () => {
	it("keeps native controls on AXPress and explicit accessibility on AXPress", async () => {
		for (const options of [{}, { press: "accessibility" }]) {
			const computer = webComputer(options.press === undefined ? [] : [9]);
			const harness = await createHarness(computer);
			closeHarness = harness.close;

			const result = await harness.client.callTool({
				name: "click_target",
				arguments: { app: "Finder", query: { label: "Open" }, ...options },
			});

			expect(result.isError).toBeFalsy();
			expect(computer.effects).toContainEqual({
				kind: "performAction",
				pid: 1234,
				id: 9,
				action: "AXPress",
			});
			await harness.close();
			closeHarness = undefined;
		}
	});

	it("keeps explicit pointer clicks away from the accessibility point hit test", async () => {
		const computer = webComputer([]);
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" }, press: "pointer" },
		});

		expect(result.isError).toBeFalsy();
		expect(computer.effects).toContainEqual({ kind: "click", point: { x: 350, y: 230 } });
		expect(computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});
});

describe("#given guarded web pointer input #when approval or observed bounds fail #then no input is sent", () => {
	it("refuses an unapproved app and consumes stale observations", async () => {
		const computer = webComputer();
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);
		computer.preflightResult = { ok: false, reason: "app-not-approved" };

		const refused = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});
		const stale = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(refused.isError).toBe(true);
		expect(stale.isError).toBe(true);
		expect(computer.effects).toEqual([]);
	});

	it("refuses a web element without a usable current frame", async () => {
		const computer = webComputer();
		computer.elementFrames.set(9, { x: 0, y: 0, width: 0, height: 40 });
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(result.isError).toBe(true);
		expect(computer.effects).toEqual([]);
	});
});
