import type { TopLevelWindow } from "@macos-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, jsonText, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

function window(title: string): TopLevelWindow {
	return { id: 4, ownerPid: 1234, ownerName: "Finder", title, bounds: { x: 0, y: 0, width: 800, height: 600 } };
}

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

describe("#given an app state worth checking #when verify_state runs #then it answers with evidence per expectation", () => {
	it("confirms an unchanged field value and re-issues an observation token", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: {
					app: "Finder",
					observation_token: token,
					checks: [{ element_index: "20", value: "draft" }],
				},
			}),
		);

		expect(payload["verified"]).toBe(true);
		expect(payload["checks"]).toEqual([
			{ check: 'element 20 value is "draft"', verified: true, actual: 'value "draft"' },
		]);
		expect(typeof payload["observation_token"]).toBe("string");
	});

	it("reports the actual value when the expectation does not hold", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: {
					app: "Finder",
					observation_token: token,
					checks: [{ element_index: "20", value: "sent" }],
				},
			}),
		);

		expect(payload["verified"]).toBe(false);
		expect(payload["checks"]).toEqual([
			{ check: 'element 20 value is "sent"', verified: false, actual: 'value "draft"' },
		]);
	});

	it("confirms a removed element and refuses to confirm a present one", async () => {
		const computer = new FakeGuardedComputer();
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const gone = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: {
					app: "Finder",
					observation_token: token,
					checks: [{ element_index: "9", exists: false }],
				},
			}),
		);
		expect(gone["verified"]).toBe(false);
		expect(gone["checks"]).toEqual([{ check: "element 9 is absent", verified: false, actual: 'AXButton "Open"' }]);

		const computerWithoutElement = new FakeGuardedComputer();
		computerWithoutElement.hiddenElementIds.add(9);
		const secondHarness = await createHarness(computerWithoutElement);
		const secondToken = await observe(secondHarness);
		const removed = jsonPayload(
			await secondHarness.client.callTool({
				name: "verify_state",
				arguments: {
					app: "Finder",
					observation_token: secondToken,
					checks: [{ element_index: "9", exists: false }],
				},
			}),
		);
		expect(removed["verified"]).toBe(true);
		await secondHarness.close();
	});

	it("checks a window title through the window probe", async () => {
		const harness = await createHarness(new FakeGuardedComputer(), async () => [window("Documents")]);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: { app: "Finder", observation_token: token, window_title: "Documents" },
			}),
		);

		expect(payload["verified"]).toBe(true);
		expect(payload["checks"]).toEqual([
			{ check: 'a window titled "Documents" is open', verified: true, actual: "Documents" },
		]);
	});

	it("says window titles are unavailable rather than claiming a match when no probe exists", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: { app: "Finder", observation_token: token, window_title: "Documents" },
			}),
		);

		expect(payload["verified"]).toBe(false);
		expect(payload["checks"]).toEqual([
			{
				check: 'a window titled "Documents" is open',
				verified: false,
				actual: "window titles are unavailable",
			},
		]);
	});

	it("rejects a token that was already consumed by a mutation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		const replay = await harness.client.callTool({
			name: "verify_state",
			arguments: { app: "Finder", observation_token: token, checks: [{ element_index: "9" }] },
		});

		expect(replay.isError).toBe(true);
		expect(jsonText(replay)).toContain("observation token is missing, stale, or already consumed");
	});
});
