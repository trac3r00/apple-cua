import type { AppState, AppStateOptions, TopLevelWindow } from "@apple-cua/core";
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
	it.each([
		["Private folder", true],
		["Different folder", false],
	])("checks requested title %s against AX when the window probe cannot expose titles", async (title, verified) => {
		class TitledComputer extends FakeGuardedComputer {
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				return { ...(await super.getAppState(targetPid, options)), windowTitle: "Private folder" };
			}
		}
		const harness = await createHarness(new TitledComputer(), async () => [window("")]);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: { app: "Finder", observation_token: token, window_title: title },
			}),
		);

		expect(payload["verified"]).toBe(verified);
	});

	it("satisfies a batch title wait from the observed AX title without Screen Recording metadata", async () => {
		class TitledComputer extends FakeGuardedComputer {
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				return { ...(await super.getAppState(targetPid, options)), windowTitle: "Private folder" };
			}
		}
		const harness = await createHarness(new TitledComputer(), async () => [window("")]);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [{ type: "wait_for", window_title: "Private folder", timeout_ms: 1 }],
				},
			}),
		);

		expect(payload["runSteps"]).toMatchObject({
			completed: 0,
			stoppedEarly: false,
			steps: [{ type: "wait_for", status: "satisfied", input_dispatched: false }],
		});
	});

	it("reads the token's selected window even when another document becomes the default", async () => {
		class TwoWindowComputer extends FakeGuardedComputer {
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				this.windowId = options?.windowId ?? 72;
				this.fieldValues.set(20, this.windowId === 71 ? "target document" : "other document");
				return { ...(await super.getAppState(targetPid, options)), windowId: this.windowId };
			}
		}
		const harness = await createHarness(new TwoWindowComputer());
		closeHarness = harness.close;
		const observed = jsonPayload(
			await harness.client.callTool({
				name: "get_app_state",
				arguments: { app: "Finder", window_id: 71 },
			}),
		);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: {
					app: "Finder",
					observation_token: observed["observation_token"],
					checks: [{ element_index: "20", value: "target document" }],
				},
			}),
		);

		expect(payload["verified"]).toBe(true);
	});

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
