import type { PreflightResult } from "@macos-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { GuardedSession } from "./guarded-session.js";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { Deferred, type Effect, FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("FIFO token queue #given concurrent protocol calls #when work overlaps #then input remains single-target and single-use", () => {
	it("dispatches only one duplicate request and preserves its newly issued token", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const entered = new Deferred<void>();
		const gate = new Deferred<PreflightResult>();
		harness.computer.preflightEntered = entered;
		harness.computer.preflightGate = gate;

		const first = harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "first" },
		});
		const duplicate = harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "duplicate" },
		});
		await entered.promise;
		gate.resolve({ ok: true });
		const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
		const nextToken = jsonPayload(firstResult)["observation_token"];

		expect(duplicateResult.isError).toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "type", text: "first" }]);
		expect(typeof nextToken).toBe("string");
		const next = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: nextToken, text: "next" },
		});
		expect(next.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "type", text: "first" },
			{ kind: "type", text: "next" },
		]);
	});

	it("does not retarget an in-flight action when another app observation is queued", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const entered = new Deferred<void>();
		const gate = new Deferred<PreflightResult>();
		harness.computer.preflightEntered = entered;
		harness.computer.preflightGate = gate;

		const action = harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: token, element_index: "9", value: "safe" },
		});
		const retarget = harness.client.callTool({ name: "get_app_state", arguments: { app: "Other" } });
		await entered.promise;
		gate.resolve({ ok: true });
		await Promise.all([action, retarget]);

		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 9, value: "safe" }]);
		expect(harness.computer.getInputObservation(5678)?.pid).toBe(5678);
	});

	it("preserves a newer token when an older queued request is rejected", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const staleToken = await observe(harness);
		const currentToken = await observe(harness);

		const stale = harness.client.callTool({
			name: "press_keys",
			arguments: { app: "Finder", observation_token: staleToken, keys: ["Escape"] },
		});
		const current = harness.client.callTool({
			name: "press_keys",
			arguments: { app: "Finder", observation_token: currentToken, keys: ["Return"] },
		});
		const [staleResult, currentResult] = await Promise.all([stale, current]);

		expect(staleResult.isError).toBe(true);
		expect(currentResult.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "key", key: "Return" }]);
	});

	it("invalidates in-flight and queued input before computer teardown", async () => {
		const computer = new FakeGuardedComputer();
		const session = new GuardedSession(computer);
		const token = jsonPayload(await session.observe({ app: "Finder", diffOnly: false }))["observation_token"];
		if (typeof token !== "string") {
			throw new Error("observation token was not issued");
		}
		const entered = new Deferred<void>();
		const gate = new Deferred<PreflightResult>();
		computer.preflightEntered = entered;
		computer.preflightGate = gate;
		const action = async () => await computer.type("blocked");

		const first = session.mutate(token, "Finder", () => undefined, action);
		const queued = session.mutate(token, "Finder", () => undefined, action);
		await entered.promise;
		const close = session.close();
		gate.resolve({ ok: true });
		const [firstResult, queuedResult] = await Promise.allSettled([first, queued]);
		await close;

		expect(firstResult.status).toBe("rejected");
		expect(queuedResult.status).toBe("rejected");
		expect(computer.effects).toEqual([{ kind: "close" }]);
	});
});

function inputEffects(effects: readonly Effect[]): readonly Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}

describe("per-app lanes #given two apps #when both are observed #then each keeps its own live token", () => {
	it("accepts a mutation for one app after another app was observed", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const finderToken = await observe(harness);
		await observe(harness, "Other");

		await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: finderToken, element_index: "9", value: "safe" },
		});

		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 9, value: "safe" }]);
	});

	it("still invalidates an app's own previous token when that app is observed again", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const first = await observe(harness);
		const second = await observe(harness);

		const stale = await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: first, element_index: "9", value: "safe" },
		});

		expect(stale.isError).toBe(true);
		expect(jsonPayload(stale).reason).toBe("stale-observation-token");
		const current = await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: second, element_index: "9", value: "safe" },
		});
		expect(current.isError).toBeFalsy();
	});

	it("lets another app's observation finish while an action is still in flight", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		const entered = new Deferred<void>();
		const gate = new Deferred<PreflightResult>();
		harness.computer.preflightEntered = entered;
		harness.computer.preflightGate = gate;

		const action = harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: token, element_index: "9", value: "safe" },
		});
		await entered.promise;
		await harness.client.callTool({ name: "get_app_state", arguments: { app: "Other" } });

		expect(inputEffects(harness.computer.effects)).toEqual([]);
		gate.resolve({ ok: true });
		await action;
		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 9, value: "safe" }]);
	});
});
