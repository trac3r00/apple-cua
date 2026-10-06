import { InputInterrupted, currentInputScope } from "@apple-cua/core";
import type { PreflightResult, StopStatus, StopStatusSource } from "@apple-cua/core";
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

describe("input targets #given batches for two apps run at once #when one app's input waits mid-dispatch #then no input reaches the other app", () => {
	it("#when both apps' input is held at the same moment and then released #then each went to its own app and observed window", async () => {
		// given
		const harness = await start();
		harness.computer.delivery = "background";
		const finderToken = await observe(harness, "Finder");
		const otherToken = await observe(harness, "Other");
		const releases: Deferred<void>[] = [];
		const bothHeld = new Deferred<void>();
		harness.computer.inputGate = async () => {
			const release = new Deferred<void>();
			releases.push(release);
			if (releases.length === 2) {
				bothHeld.resolve(undefined);
			}
			await release.promise;
		};

		// when: each batch's input is parked after its app was aimed at and before it went out
		const running = harness.client.callTool({
			name: "run_parallel",
			arguments: {
				batches: [
					{ app: "Finder", observation_token: finderToken, steps: [{ type: "type_text", text: "for finder" }] },
					{ app: "Other", observation_token: otherToken, steps: [{ type: "click", x: 10, y: 20 }] },
				],
			},
		});
		await bothHeld.promise;
		for (const release of releases) {
			release.resolve(undefined);
		}
		const result = await running;

		// then
		expect(jsonPayload(result)).toMatchObject({
			batches: [
				{ app: "Finder", ok: true },
				{ app: "Other", ok: true },
			],
		});
		const delivered = harness.computer.targetedInputs.map((input) => ({
			kind: input.effect.kind,
			pid: input.pid,
			windowId: input.windowId,
		}));
		expect(delivered).toHaveLength(2);
		expect(delivered).toContainEqual({ kind: "type", pid: 1234, windowId: 71 });
		expect(delivered).toContainEqual({ kind: "click", pid: 5678, windowId: 71 });
	});
});

describe("stop at dispatch #given the stop switch flips after the last check #when input is about to go out #then it is refused", () => {
	it("#when the stop flips while the preflight is still deciding #then type_text and click send nothing", async () => {
		// given
		const stop = new MutableStop();
		const harness = await start(new FakeGuardedComputer(), stop);
		const answers: Awaited<ReturnType<typeof harness.client.callTool>>[] = [];

		for (const call of [
			{ name: "type_text", arguments: { app: "Finder", text: "never" } },
			{ name: "click", arguments: { app: "Finder", x: 10, y: 20 } },
		]) {
			stop.state = { stopped: false };
			const token = await observe(harness);
			const entered = new Deferred<void>();
			const decision = new Deferred<PreflightResult>();
			harness.computer.preflightEntered = entered;
			harness.computer.preflightGate = decision;

			// when
			const pending = harness.client.callTool({
				name: call.name,
				arguments: { ...call.arguments, observation_token: token },
			});
			await entered.promise;
			stop.stop();
			decision.resolve({ ok: true });
			answers.push(await pending);
		}

		// then
		for (const answer of answers) {
			expect(answer.isError).toBe(true);
			expect(jsonPayload(answer)).toMatchObject({
				actionDispatched: false,
				effect: "refused",
				reason: "user-stopped",
			});
		}
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("#when the stop flips while a chain step reads its target #then that step is skipped before its input goes out", async () => {
		// given
		const stop = new MutableStop();
		const computer = new FakeGuardedComputer();
		const harness = await start(computer, stop);
		const token = await observe(harness);
		computer.onStateCall = () => stop.stop();

		// when
		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [
						{ type: "type_text", text: "first" },
						{ type: "click", target: { label: "Open" } },
					],
				},
			}),
		);

		// then
		expect(inputEffects(computer.effects)).toEqual([{ kind: "type", text: "first" }]);
		expect(payload["runSteps"]).toMatchObject({
			completed: 1,
			stoppedEarly: true,
			refused: "user-stopped",
			steps: [{ status: "dispatched" }, { status: "skipped", reason: expect.stringContaining("apple-cua resume") }],
		});
	});

	it("#when the stop flips part-way through typed text #then the rest is never typed and the answer says input was stopped", async () => {
		// given: a computer that, like the native driver, reads its input scope before every character
		const stop = new MutableStop();
		const computer = new FakeGuardedComputer();
		const typed: string[] = [];
		computer.type = async (text: string) => {
			for (const character of text) {
				const reason = currentInputScope()?.interruption?.();
				if (reason !== undefined) {
					throw new InputInterrupted(reason);
				}
				typed.push(character);
				if (typed.length === 3) {
					stop.stop();
				}
			}
		};
		const harness = await start(computer, stop);

		// when
		const single = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: await observe(harness), text: "abcdefgh" },
		});
		stop.state = { stopped: false };
		typed.length = 0;
		const token = await observe(harness);
		const chain = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [
						{ type: "type_text", text: "abcdefgh" },
						{ type: "press_keys", keys: ["return"] },
					],
				},
			}),
		);

		// then
		expect(single.isError).toBe(true);
		expect(jsonPayload(single)).toMatchObject({
			actionDispatched: true,
			refused: "user-stopped",
			error: expect.stringContaining("apple-cua resume"),
		});
		expect(typed).toEqual(["a", "b", "c"]);
		expect(chain["runSteps"]).toMatchObject({
			completed: 0,
			stoppedEarly: true,
			refused: "user-stopped",
			steps: [
				{ status: "failed", reason: expect.stringContaining("stopped while this step was sending input") },
				{ status: "skipped", reason: expect.stringContaining("apple-cua resume") },
			],
		});
		expect(inputEffects(computer.effects).filter((effect) => effect.kind === "key")).toEqual([]);
	});
});

describe("window guard #given a verified-pace chain #when the window closes or approval is revoked after a step #then the next step is refused", () => {
	const KEYBOARD_STEPS = [
		{ type: "type_text", text: "one" },
		{ type: "press_keys", keys: ["return"] },
	];
	const COORDINATE_STEPS = [
		{ type: "click", x: 10, y: 20 },
		{ type: "click", x: 30, y: 40 },
	];

	it.each([
		["window-missing", "keyboard", KEYBOARD_STEPS],
		["app-not-approved", "keyboard", KEYBOARD_STEPS],
		["window-missing", "coordinate", COORDINATE_STEPS],
		["app-not-approved", "coordinate", COORDINATE_STEPS],
	] as const)(
		"#when %s holds after the first %s step #then the second is refused unsent",
		async (reason, _kind, steps) => {
			// given
			const computer = new FakeGuardedComputer();
			const harness = await start(computer);
			const token = await observe(harness);
			computer.inputGate = async () => {
				computer.preflightResult = { ok: false, reason };
			};

			// when
			const payload = jsonPayload(
				await harness.client.callTool({
					name: "run_steps",
					arguments: { app: "Finder", observation_token: token, steps },
				}),
			);

			// then
			expect(inputEffects(computer.effects)).toHaveLength(1);
			expect(payload["runSteps"]).toMatchObject({
				completed: 1,
				stoppedEarly: true,
				refused: reason,
				steps: [{ status: "dispatched" }, { status: "skipped", reason: expect.stringContaining(reason) }],
			});
		},
	);
});
