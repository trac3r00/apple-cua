import type { AxEventWaiter } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AxWaiterFactory,
	DEFERRED_SETTLE_DEADLINE_MS,
	DEFERRED_SETTLE_QUIET_MS,
	settleDeferredOutcome,
} from "./deferred-settle.js";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import { deferredHandsResult } from "./tool-result.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

function fakeWaiter(drainOutcome: () => number): AxEventWaiter {
	let released = false;
	return {
		drain: () => (released ? 0 : drainOutcome()),
		release: () => {
			released = true;
		},
	};
}

describe("#given an input-only call #when run_hands defaults to a deferred outcome #then no result read runs and the token carries the caveat", () => {
	it("answers from the settle instead of a fresh observation", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);
		const readsBefore = computer.stateOptions.length;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_hands",
				arguments: {
					app: "Finder",
					observation_token: token,
					keyboard: [{ type: "type_text", text: "fast" }],
				},
			}),
		);

		expect(computer.stateOptions).toHaveLength(readsBefore);
		expect(payload["outcome"]).toBe("deferred");
		expect(payload["observationStatus"]).toBe("deferred");
		expect(payload["actionDispatched"]).toBe(true);
		expect(typeof payload["observation_token"]).toBe("string");
		expect(payload["paused"]).toBe(false);
		expect(payload["ax_events"]).toEqual(expect.any(Number));
		expect(payload["settle_ms"]).toEqual(expect.any(Number));
		expect(payload["window_id"]).toEqual(expect.any(Number));
		expect(String(payload["outcome_note"])).toContain("element ids predate this action");
	});

	it("keeps the deferred token valid for keyboard input and refuses nothing", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const deferred = jsonPayload(
			await harness.client.callTool({
				name: "run_hands",
				arguments: {
					app: "Finder",
					observation_token: token,
					keyboard: [{ type: "type_text", text: "first" }],
				},
			}),
		);
		const next = jsonPayload(
			await harness.client.callTool({
				name: "run_hands",
				arguments: {
					app: "Finder",
					observation_token: deferred["observation_token"],
					keyboard: [{ type: "type_text", text: "second" }],
					outcome: "live",
				},
			}),
		);
		const hands =
			typeof next["hands"] === "object" && next["hands"] !== null
				? Object.fromEntries(Object.entries(next["hands"]))
				: {};

		expect(next["outcome"]).toBeUndefined();
		expect(hands["lanes"]).toEqual([expect.objectContaining({ status: "completed" })]);
	});
});

describe("#given an outcome that cannot be deferred #when run_hands runs #then it reads the result live", () => {
	it.each([
		["expect", { expect: { checks: [{ element_index: "9" }] } }],
		["full_state", { full_state: true }],
		["include_screenshot", { include_screenshot: true }],
		["outcome live", { outcome: "live" }],
	])("%s forces the live read", async (_label, extra) => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);
		const readsBefore = computer.stateOptions.length;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_hands",
				arguments: {
					app: "Finder",
					observation_token: token,
					keyboard: [{ type: "type_text", text: "typed" }],
					...extra,
				},
			}),
		);

		expect(payload["outcome"]).toBeUndefined();
		expect(computer.stateOptions.length).toBeGreaterThan(readsBefore);
	});
});

describe("#given a vision capture #when the outcome is deferred #then the capture runs and no result read follows", () => {
	it("answers the capture without an outcome read", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);
		const readsBefore = computer.stateOptions.length;

		const result = await harness.client.callTool({
			name: "run_hands",
			arguments: {
				app: "Finder",
				observation_token: token,
				vision: { include_screenshot: true },
			},
		});
		const payload = jsonPayload(result);
		const hands =
			payload["hands"] !== undefined && typeof payload["hands"] === "object" && payload["hands"] !== null
				? Object.fromEntries(Object.entries(payload["hands"]))
				: {};

		expect(payload["outcome"]).toBe("deferred");
		expect(hands["vision"]).toEqual(expect.objectContaining({ captured: true }));
		expect(result.content).toContainEqual({
			type: "image",
			data: Buffer.from("png-bytes").toString("base64"),
			mimeType: "image/png",
		});
		expect(computer.stateOptions).toHaveLength(readsBefore + 1);
	}, 2_000);
});

describe("#given a lane that failed or was stopped #when the outcome was deferred #then the session reads live instead of guessing", () => {
	it("falls back to a live read when the stop switch cuts a lane", async () => {
		let stopped = false;
		const stopSwitch = {
			status: () =>
				stopped
					? {
							stopped: true as const,
							stoppedAt: new Date(0).toISOString(),
							reason: "test stop",
							source: "api" as const,
						}
					: { stopped: false as const },
		};
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer, undefined, undefined, { stopSwitch });
		closeHarness = harness.close;
		const token = await observe(harness);
		computer.inputGate = async (effect) => {
			if (effect.kind === "type") {
				stopped = true;
			}
		};
		const readsBefore = computer.stateOptions.length;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_hands",
				arguments: {
					app: "Finder",
					observation_token: token,
					keyboard: [
						{ type: "type_text", text: "one" },
						{ type: "type_text", text: "two" },
					],
				},
			}),
		);

		expect(payload["outcome"]).toBeUndefined();
		expect(payload["effect"]).toBe("partial");
		expect(computer.stateOptions.length).toBeGreaterThan(readsBefore);
	});
});

describe("#given events flow from the app #when the deferred outcome settles #then the effect says observed_change with ax_events evidence", () => {
	it("maps events to the observed_change effect and silence to unverifiable", () => {
		const observation = {
			generation: 1,
			pid: 1234,
			bundleId: "com.apple.finder",
			windowId: 4,
			windowBounds: { x: 0, y: 0, width: 800, height: 600 },
			screenshotViewport: { width: 800, height: 600, bounds: { x: 0, y: 0, width: 800, height: 600 } },
			observedElementIds: new Set<number>(),
		};
		const report = {
			policy: "auto" as const,
			overlap_ms: 0,
			sequential_estimate_ms: 10,
			aborted: false,
			lanes: [],
		};
		const withEvents = jsonPayload(
			deferredHandsResult(observation, report, { events: 4, settleMs: 41 }, "token-1", {
				route: "accessibility",
				delivery: "background",
			}),
		);
		expect(withEvents["effect"]).toBe("observed_change");
		expect(withEvents["evidence"]).toEqual([{ kind: "ax_events" }]);
		expect(withEvents["ax_events"]).toBe(4);

		const silent = jsonPayload(
			deferredHandsResult(observation, report, { events: 0, settleMs: 120 }, "token-1", {
				route: "accessibility",
				delivery: "background",
			}),
		);
		expect(silent["effect"]).toBe("unverifiable");
		expect(silent["evidence"]).toEqual([]);
		expect(silent["observation_token"]).toBe("token-1");
	});
});

describe("#given the settle watches a bounded window #when the app stays quiet #then it reports no events within its deadline", () => {
	it("counts events and returns after quiet, without sleeping past the deadline", () => {
		let nowMs = 0;
		const queue: number[] = [1, 1, 0];
		const waiter = fakeWaiter(() => {
			nowMs += DEFERRED_SETTLE_QUIET_MS;
			return queue.shift() ?? 0;
		});
		const factory: AxWaiterFactory = () => waiter;
		const settle = settleDeferredOutcome(1234, { waiterFactory: factory, now: () => nowMs });
		expect(settle.events).toBe(2);
		expect(settle.settleMs).toBe(45);
	});

	it("reports zero events when the app never answers within the deadline", () => {
		let nowMs = 0;
		const waiter = fakeWaiter(() => {
			nowMs += DEFERRED_SETTLE_QUIET_MS;
			return 0;
		});
		const settle = settleDeferredOutcome(1234, { waiterFactory: () => waiter, now: () => nowMs });
		expect(settle.events).toBe(0);
		expect(settle.settleMs).toBeLessThanOrEqual(DEFERRED_SETTLE_DEADLINE_MS + DEFERRED_SETTLE_QUIET_MS);
	});

	it("skips the wait entirely when the observer is unavailable", () => {
		const settle = settleDeferredOutcome(1234, { waiterFactory: () => null });
		expect(settle).toEqual({ events: 0, settleMs: 0 });
	});
});
