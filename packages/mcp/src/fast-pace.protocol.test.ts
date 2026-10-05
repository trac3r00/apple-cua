import type { StopStatus, StopStatusSource } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { Deferred, FakeGuardedComputer } from "./protocol-test-harness.js";
import type { Effect } from "./protocol-test-harness.js";

class MutableStop implements StopStatusSource {
	state: StopStatus = { stopped: false };

	stop(): void {
		this.state = { stopped: true, stoppedAt: "2026-01-01T00:00:00.000Z", reason: "test", source: "chord" };
	}

	status(): StopStatus {
		return this.state;
	}
}

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

async function start(computer = new FakeGuardedComputer(), stopSwitch?: StopStatusSource) {
	const harness = await createHarness(
		computer,
		undefined,
		undefined,
		stopSwitch === undefined ? undefined : { stopSwitch },
	);
	closeHarness = harness.close;
	return harness;
}

function inputEffects(effects: readonly Effect[]): Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}

/** Reads that walk the UI before a step: the pre-dispatch freshness read is the only one asking for an 80 ms settle. */
function preDispatchReads(computer: FakeGuardedComputer): number {
	return computer.stateOptions.filter((options) => options?.settleMs === 80).length;
}

const CHAIN = [
	{ type: "set_value", target: { label: "Note" }, value: "first" },
	{ type: "set_value", target: { label: "Status" }, value: "second" },
	{ type: "click", target: { label: "Open" } },
	{ type: "type_text", text: "typed" },
	{ type: "press_keys", keys: ["return"] },
];

describe("run_steps pace #given a person-like chain #when pace is fast #then no tree is read between steps", () => {
	it("dispatches every step after one up-front read, where verified pace reads before each element step", async () => {
		const fast = await start();
		const fastToken = await observe(fast);
		const fastPayload = jsonPayload(
			await fast.client.callTool({
				name: "run_steps",
				arguments: { app: "Finder", observation_token: fastToken, steps: CHAIN, pace: "fast" },
			}),
		);

		expect(fastPayload["runSteps"]).toMatchObject({
			requested: 5,
			completed: 5,
			stoppedEarly: false,
			pace: "fast",
			tree_reads: 0,
			pace_note: expect.stringContaining("intermediate states were not individually read"),
			steps: [
				{ status: "dispatched" },
				{ status: "dispatched" },
				{ status: "dispatched" },
				{ status: "dispatched" },
				{ status: "dispatched" },
			],
		});
		expect(inputEffects(fast.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "first" },
			{ kind: "setValue", pid: 1234, id: 21, value: "second" },
			{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
			{ kind: "type", text: "typed" },
			{ kind: "key", key: "return" },
		]);
		// The observation's own read answers every target: nothing is read before any step.
		expect(preDispatchReads(fast.computer)).toBe(0);
		// One preflight before the chain and one cheap guard before each later step.
		expect(fast.computer.preflightExpected).toHaveLength(5);

		await fast.close();
		closeHarness = undefined;
		const verified = await start();
		const verifiedToken = await observe(verified);
		const verifiedPayload = jsonPayload(
			await verified.client.callTool({
				name: "run_steps",
				arguments: { app: "Finder", observation_token: verifiedToken, steps: CHAIN },
			}),
		);

		expect(verifiedPayload["runSteps"]).not.toHaveProperty("pace");
		expect(preDispatchReads(verified.computer)).toBe(2);
		expect(verified.computer.preflightExpected).toHaveLength(1);
	});

	it("keeps the bounds requirement for pointer steps and drops it for keyboard steps", async () => {
		const harness = await start();
		const token = await observe(harness);

		await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				pace: "fast",
				steps: [
					{ type: "type_text", text: "a" },
					{ type: "click", target: { label: "Open" } },
					{ type: "press_keys", keys: ["tab"] },
				],
			},
		});

		expect(harness.computer.preflightOptions.slice(1)).toEqual([
			{ requireSameBounds: true },
			{ requireSameBounds: false },
		]);
	});

	it("reads again for a target an earlier step created, and for that step only", async () => {
		const computer = new FakeGuardedComputer();
		computer.hiddenElementIds.add(21);
		const performAction = computer.performAction.bind(computer);
		computer.performAction = async (pid, id, action) => {
			await performAction(pid, id, action);
			computer.hiddenElementIds.delete(21);
		};
		const harness = await start(computer);
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					pace: "fast",
					steps: [
						{ type: "click", target: { label: "Open" } },
						{ type: "type_text", text: "typed" },
						{ type: "set_value", target: { label: "Status" }, value: "created" },
						{ type: "press_keys", keys: ["return"] },
					],
				},
			}),
		);

		expect(payload["runSteps"]).toMatchObject({ completed: 4, stoppedEarly: false, tree_reads: 1 });
		expect(inputEffects(computer.effects)).toContainEqual({ kind: "setValue", pid: 1234, id: 21, value: "created" });
		// Only the created target reads; the typing and key steps read nothing.
		expect(preDispatchReads(computer)).toBe(1);
	});

	it("reads again after a wait_for instead of trusting the earlier tree", async () => {
		const harness = await start();
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					pace: "fast",
					steps: [
						{ type: "set_value", target: { label: "Note" }, value: "one" },
						{ type: "wait_for", target: { label: "Status" }, timeout_ms: 500 },
						{ type: "set_value", target: { label: "Status" }, value: "two" },
					],
				},
			}),
		);

		expect(payload["runSteps"]).toMatchObject({
			completed: 2,
			stoppedEarly: false,
			tree_reads: 1,
			steps: [{ status: "dispatched" }, { status: "satisfied" }, { status: "dispatched" }],
		});
	});

	it("stops between steps when the stop switch is thrown mid-chain", async () => {
		const stop = new MutableStop();
		const computer = new FakeGuardedComputer();
		const type = computer.type.bind(computer);
		computer.type = async (text: string) => {
			await type(text);
			stop.stop();
		};
		const harness = await start(computer, stop);
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					pace: "fast",
					steps: [
						{ type: "click", target: { label: "Open" } },
						{ type: "type_text", text: "first" },
						{ type: "type_text", text: "second" },
						{ type: "press_keys", keys: ["return"] },
					],
				},
			}),
		);

		expect(inputEffects(computer.effects)).toEqual([
			{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
			{ kind: "type", text: "first" },
		]);
		expect(payload["runSteps"]).toMatchObject({
			completed: 2,
			stoppedEarly: true,
			refused: "user-stopped",
			pace: "fast",
			steps: [{ status: "dispatched" }, { status: "dispatched" }, { status: "skipped" }, { status: "skipped" }],
		});
	});

	it("refuses the rest of the chain when the observed window disappears mid-chain", async () => {
		const computer = new FakeGuardedComputer();
		const preflight = computer.preflightInput.bind(computer);
		computer.preflightInput = async (expected, options) =>
			computer.effects.length === 0 ? await preflight(expected, options) : { ok: false, reason: "window-missing" };
		const harness = await start(computer);
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					pace: "fast",
					steps: [
						{ type: "click", target: { label: "Open" } },
						{ type: "type_text", text: "typed" },
						{ type: "press_keys", keys: ["return"] },
					],
				},
			}),
		);

		expect(inputEffects(computer.effects)).toEqual([{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" }]);
		expect(payload["runSteps"]).toMatchObject({
			completed: 1,
			stoppedEarly: true,
			refused: "window-missing",
			steps: [
				{ status: "dispatched" },
				{ status: "skipped", reason: expect.stringContaining("window-missing") },
				{ status: "skipped" },
			],
		});
	});

	it("still verifies the expect block after the chain", async () => {
		const harness = await start();
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					pace: "fast",
					steps: [
						{ type: "set_value", element_index: "20", value: "published" },
						{ type: "set_value", element_index: "21", value: "done" },
					],
					expect: { checks: [{ element_index: "20", value: "published" }] },
				},
			}),
		);

		expect(payload["verification"]).toMatchObject({ verified: true });
		expect(payload["effect"]).toBe("confirmed");
		expect(payload["observation_token"]).toEqual(expect.any(String));
	});
});

describe("run_parallel pace #given batches for two apps #when pace is fast #then each chain runs without intermediate reads", () => {
	it("applies the pace to every batch", async () => {
		const harness = await start();
		const finderToken = await observe(harness, "Finder");
		const otherToken = await observe(harness, "Other");

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_parallel",
				arguments: {
					pace: "fast",
					batches: [
						{
							app: "Finder",
							observation_token: finderToken,
							steps: [
								{ type: "set_value", target: { label: "Note" }, value: "a" },
								{ type: "set_value", target: { label: "Status" }, value: "b" },
							],
						},
						{
							app: "Other",
							observation_token: otherToken,
							steps: [{ type: "set_value", target: { label: "Note" }, value: "c" }],
						},
					],
				},
			}),
		);

		expect(payload["batches"]).toMatchObject([
			{ app: "Finder", ok: true, result: { runSteps: { completed: 2, pace: "fast", tree_reads: 0 } } },
			{ app: "Other", ok: true, result: { runSteps: { completed: 1, pace: "fast", tree_reads: 0 } } },
		]);
	});
});

describe("run_script pace #given a chain #when the script uses chain or batch pace fast #then it runs in fast pace", () => {
	it("chain and batch with pace fast report the pace and still honour expect", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						const chained = await finder.chain([
							apple.steps.setValue({ label: "Note" }, "one"),
							apple.steps.setValue({ label: "Status" }, "two"),
						]);
						const batched = await finder.batch(
							[apple.steps.setValue({ label: "Note" }, "three"), apple.steps.click({ label: "Open" })],
							{ pace: "fast", expect: { checks: [{ element_index: 20, value: "three" }] } },
						);
						return {
							chained: chained.runSteps.pace,
							batched: batched.runSteps.pace,
							verified: batched.verification.verified,
						};
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: { chained: "fast", batched: "fast", verified: true } });
	});

	it("refuses an unknown pace before dispatching", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						try {
							await finder.batch([apple.steps.press("Return")], { pace: "reckless" });
						} catch (error) {
							return error.refused;
						}
						return "dispatched";
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: "invalid-argument" });
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_script queues #given actions on two apps #when the script awaits them together #then apps overlap and one app stays ordered", () => {
	const SCRIPT = `
		const finder = apple.app("Finder");
		const other = apple.app("Other");
		await Promise.all([finder.observe(), other.observe()]);
		await Promise.all([
			finder.setValue({ label: "Note" }, "first"),
			finder.setValue({ label: "Status" }, "second"),
			other.setValue({ label: "Note" }, "other"),
		]);
	`;

	it("lets another app's action run while one app's first action is still in flight", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const otherReached = new Deferred<void>();
		const preflight = computer.preflightInput.bind(computer);
		const finderEffectsAtPreflight: number[] = [];
		computer.preflightInput = async (expected, options) => {
			if (expected.pid === 5678) {
				otherReached.resolve(undefined);
			} else {
				finderEffectsAtPreflight.push(
					computer.effects.filter((effect) => "pid" in effect && effect.pid === 1234).length,
				);
				if (finderEffectsAtPreflight.length === 1) {
					// Only a queue that lets the other app run can ever release this one.
					await otherReached.promise;
				}
			}
			return await preflight(expected, options);
		};
		const harness = await start(computer);

		const payload = jsonPayload(await harness.client.callTool({ name: "run_script", arguments: { code: SCRIPT } }));

		expect(payload).toMatchObject({ ok: true });
		// The second Finder action only started once the first had dispatched.
		expect(finderEffectsAtPreflight).toEqual([0, 1]);
		expect(inputEffects(computer.effects)).toContainEqual({ kind: "setValue", pid: 1234, id: 20, value: "first" });
		expect(inputEffects(computer.effects)).toContainEqual({ kind: "setValue", pid: 1234, id: 21, value: "second" });
		expect(inputEffects(computer.effects)).toContainEqual({ kind: "setValue", pid: 5678, id: 20, value: "other" });
		const numbers = (payload["actions"] as readonly { readonly n: number }[]).map((action) => action.n);
		expect(new Set(numbers).size).toBe(numbers.length);
	});

	it("keeps every action in call order under attended delivery", async () => {
		const harness = await start();

		const payload = jsonPayload(await harness.client.callTool({ name: "run_script", arguments: { code: SCRIPT } }));

		expect(payload).toMatchObject({ ok: true });
		expect(inputEffects(harness.computer.effects).map((effect) => ("pid" in effect ? effect.pid : 0))).toEqual([
			1234, 1234, 5678,
		]);
	});
});
