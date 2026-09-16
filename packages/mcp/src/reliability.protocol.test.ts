import type { TopLevelWindow } from "@macos-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

function window(id: number, title: string): TopLevelWindow {
	return { id, ownerPid: 1234, ownerName: "Finder", title, bounds: { x: 0, y: 0, width: 800, height: 600 } };
}

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

describe("#given a mutation #when it is dispatched #then the answer states how the input travelled and what proves its effect", () => {
	it("reports the accessibility route for an element press and the observed change as its evidence", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "click",
				arguments: { app: "Finder", observation_token: token, element_index: "9" },
			}),
		);

		expect(payload["route"]).toBe("accessibility");
		expect(payload["delivery"]).toBe("background");
		expect(payload["effect"]).toBe("observed_change");
		expect(payload["evidence"]).toEqual([{ kind: "ax_change" }]);
		expect(payload["escalation"]).toBeUndefined();
	});

	it("reports the synthetic-event route and a pixel escalation when the accessibility tree did not move", async () => {
		const computer = new FakeGuardedComputer();
		computer.postActionSummary = { added: 0, removed: 0, changed: 0 };
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "click",
				arguments: { app: "Finder", observation_token: token, x: 10, y: 20 },
			}),
		);

		expect(payload["route"]).toBe("synthetic_events");
		expect(payload["observationStatus"]).toBe("unchanged");
		expect(payload["effect"]).toBe("suspected_noop");
		expect(payload["escalation"]).toEqual({ target: "foreground", reason: "suspected_noop" });
	});

	it("reports a verified field write as a confirmed effect with readback evidence", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "set_fields",
				arguments: {
					app: "Finder",
					observation_token: token,
					updates: [{ element_index: "20", value: "sent" }],
				},
			}),
		);

		expect(payload["effect"]).toBe("confirmed");
		expect(payload["evidence"]).toEqual([{ kind: "value_readback" }]);
	});
});

describe("#given an action #when a window appears while it runs #then the answer names that side effect", () => {
	it("lists the new window and records window_change evidence", async () => {
		const computer = new FakeGuardedComputer();
		let probeCalls = 0;
		const harness = await createHarness(computer, async () => {
			probeCalls += 1;
			return probeCalls === 1 ? [window(1, "Documents")] : [window(1, "Documents"), window(2, "Save")];
		});
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "click",
				arguments: { app: "Finder", observation_token: token, element_index: "9" },
			}),
		);

		expect(payload["windowEvents"]).toEqual([{ id: 2, ownerPid: 1234, ownerName: "Finder", title: "Save" }]);
		expect(payload["evidence"]).toEqual([{ kind: "ax_change" }, { kind: "window_change" }]);
	});

	it("reports no window events when the window set did not change", async () => {
		const computer = new FakeGuardedComputer();
		const harness = await createHarness(computer, async () => [window(1, "Documents")]);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "click",
				arguments: { app: "Finder", observation_token: token, element_index: "9" },
			}),
		);

		expect(payload["windowEvents"]).toBeUndefined();
		expect(payload["evidence"]).toEqual([{ kind: "ax_change" }]);
	});
});

describe("#given a refused preflight #when a mutation is attempted #then the answer says nothing was dispatched and names the next step", () => {
	it("reports a vanished window target as a refusal with a no_window_target escalation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.preflightResult = { ok: false, reason: "window-missing" };

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			actionDispatched: false,
			effect: "refused",
			route: "unknown",
			delivery: "not_applicable",
			evidence: [],
			reason: "window-missing",
			escalation: { target: "session", reason: "no_window_target" },
			needsExplicitObservation: true,
		});
		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([]);
	});

	it("maps a revoked approval to a permission escalation instead of a generic failure", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.preflightResult = { ok: false, reason: "app-not-approved" };

		const result = await harness.client.callTool({
			name: "set_value",
			arguments: { app: "Finder", observation_token: token, element_index: "20", value: "x" },
		});

		expect(jsonPayload(result)["escalation"]).toEqual({ target: "session", reason: "permission_required" });
	});

	it("refuses the same way for a multi-field write", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.preflightResult = { ok: false, reason: "window-changed" };

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: { app: "Finder", observation_token: token, updates: [{ element_index: "20", value: "x" }] },
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			effect: "refused",
			reason: "window-changed",
			escalation: { target: "session", reason: "no_window_target" },
		});
	});

	it("reports a consumed token as a stale-observation refusal rather than prose", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		const replay = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(replay.isError).toBe(true);
		expect(jsonPayload(replay)).toMatchObject({
			actionDispatched: false,
			effect: "refused",
			reason: "stale-observation-token",
			escalation: { target: "session", reason: "stale_observation" },
			needsExplicitObservation: true,
		});
	});

	it("reports an element that the token never observed as a refusal, not a crash", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "4242" },
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			effect: "refused",
			reason: "element-not-observed",
			escalation: { target: "session", reason: "stale_observation" },
		});
	});
});

describe("#given a truncated accessibility walk #when the observation is answered #then the answer says the tree is partial", () => {
	it("notes that elements were capped and how to see the rest", async () => {
		const computer = new FakeGuardedComputer();
		computer.elementsTruncated = true;
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({ name: "get_app_state", arguments: { app: "Finder" } }),
		);

		expect(payload["elementsTruncated"]).toBe(true);
		expect(String(payload["note"])).toContain("max_elements");
	});

	it("adds no note when the whole tree was walked", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({ name: "get_app_state", arguments: { app: "Finder" } }),
		);

		expect(payload["note"]).toBeUndefined();
		expect(payload["elementsTruncated"]).toBeUndefined();
	});
});
