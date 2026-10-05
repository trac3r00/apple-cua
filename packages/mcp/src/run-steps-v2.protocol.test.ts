import { afterEach, describe, expect, it } from "vitest";
import { GuardedSession } from "./guarded-session.js";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { type Effect, FakeGuardedComputer } from "./protocol-test-harness.js";
import { createRunStepDriver } from "./step-actions.js";

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

describe("run_steps #given a step that describes its element #when the batch runs #then the target resolves against a fresh read", () => {
	it("sets the field the query names and reports what it resolved to", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [{ type: "set_value", target: { role: "textfield", label: "Note" }, value: "hello" }],
			},
		});

		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 20, value: "hello" }]);
		expect(jsonPayload(result)["runSteps"]).toMatchObject({
			steps: [{ status: "dispatched", resolved_element: { id: 20, role: "AXTextField", label: "Note" } }],
		});
	});

	it("acts on a control an earlier step in the same batch made appear", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.hiddenElementIds.add(21);
		harness.computer.onStateCall = () => {
			if (harness.computer.effects.some((effect) => effect.kind === "performAction")) {
				harness.computer.hiddenElementIds.delete(21);
			}
		};
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "click", element_index: "9" },
					{ type: "wait_for", target: { label: "Status" }, timeout_ms: 1_000 },
					{ type: "set_value", target: { label: "Status" }, value: "done" },
				],
			},
		});

		expect(jsonPayload(result)["runSteps"]).toMatchObject({
			stoppedEarly: false,
			steps: [{ status: "dispatched" }, { status: "satisfied" }, { status: "dispatched" }],
		});
		expect(inputEffects(harness.computer.effects)).toContainEqual({
			kind: "setValue",
			pid: 1234,
			id: 21,
			value: "done",
		});
	});

	it("stops without dispatching when nothing matches the target", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "click", target: { label: "Does Not Exist" } },
					{ type: "type_text", text: "never" },
				],
			},
		});

		expect(jsonPayload(result)["runSteps"]).toEqual(
			expect.objectContaining({
				stoppedEarly: true,
				steps: [expect.objectContaining({ status: "skipped", input_dispatched: false })],
			}),
		);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("refuses a step that names its element both ways", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [{ type: "click", element_index: "9", target: { label: "Open" } }],
			},
		});

		expect(result.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_steps #given a wait_for step #when its condition never holds #then the batch stops honestly at the deadline", () => {
	it("fails the wait with the unmet condition and skips the rest", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "wait_for", target: { label: "Open" }, gone: true, timeout_ms: 200 },
					{ type: "type_text", text: "never" },
				],
			},
		});

		expect(jsonPayload(result)["runSteps"]).toEqual(
			expect.objectContaining({
				steps: [
					expect.objectContaining({
						status: "failed",
						input_dispatched: false,
						reason: expect.stringMatching(/still shown/),
					}),
				],
			}),
		);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_steps #given a client that asks for progress #when the batch runs #then each finished step is reported", () => {
	it("sends one progress notification per step", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const progress: number[] = [];

		await harness.client.callTool(
			{
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [
						{ type: "type_text", text: "a" },
						{ type: "type_text", text: "b" },
					],
				},
			},
			undefined,
			{ onprogress: (notification) => progress.push(notification.progress) },
		);

		expect(progress).toEqual([1, 2]);
	});
});

describe("run_steps #given a cancelled request #when the batch starts #then no step dispatches", () => {
	it("skips every step and reports the cancellation", async () => {
		const computer = new FakeGuardedComputer();
		const session = new GuardedSession(computer);
		const observed = jsonPayload(await session.observe({ app: "Finder", diffOnly: false }));
		const token = String(observed["observation_token"]);

		const result = await session.runSteps(
			token,
			"Finder",
			[
				{ type: "type_text", text: "a" },
				{ type: "type_text", text: "b" },
			],
			undefined,
			createRunStepDriver(computer),
			{},
			{ signal: AbortSignal.abort() },
		);

		const cancelled = { status: "skipped", reason: "cancelled by the client before this step ran" };
		expect(jsonPayload(result)["runSteps"]).toMatchObject({ completed: 0, steps: [cancelled, cancelled] });
		expect(inputEffects(computer.effects)).toEqual([]);
		await session.close();
	});
});
