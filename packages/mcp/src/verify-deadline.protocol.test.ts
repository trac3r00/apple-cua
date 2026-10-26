import type { AppState, AppStateOptions, TopLevelWindow } from "@apple-cua/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
	vi.restoreAllMocks();
});

describe("#given a wait condition that never appears #when its deadline expires #then elapsed time stays bounded", () => {
	it("returns within the timeout plus one polling interval", async () => {
		const harness = await createHarness(new FakeGuardedComputer(), async () => []);
		closeHarness = harness.close;
		const token = await observe(harness);

		const startedAt = Date.now();
		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [{ type: "wait_for", window_title: "Missing", timeout_ms: 20 }],
				},
			}),
		);
		const elapsedMs = Date.now() - startedAt;
		const runSteps = payload["runSteps"];
		expect(runSteps).toMatchObject({ stoppedEarly: true });
		expect(elapsedMs).toBeLessThanOrEqual(220);
	});

	it("does not start another observation after a slow first wait observation crosses the deadline", async () => {
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		class SlowComputer extends FakeGuardedComputer {
			slow = false;
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				if (this.slow && this.stateOptions.length === baselineCalls + 1) {
					now += 1000;
				}
				return super.getAppState(targetPid, options);
			}
		}
		const computer = new SlowComputer();
		const harness = await createHarness(computer, async () => []);
		closeHarness = harness.close;
		const token = await observe(harness);
		const baselineCalls = computer.stateOptions.length;
		computer.slow = true;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [{ type: "wait_for", window_title: "Missing", timeout_ms: 20 }],
				},
			}),
		);

		expect(computer.stateOptions).toHaveLength(baselineCalls + 3);
		expect(payload["runSteps"]).toMatchObject({ stoppedEarly: true });
		expect(JSON.stringify(payload["runSteps"])).toContain("1000 ms");
		// The in-flight AX walk is not raced or cancelled; deadline-aware AX walk budgets are a deferred seam.
	});

	it("does not start another verify observation after a slow first observation crosses the deadline", async () => {
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		class SlowComputer extends FakeGuardedComputer {
			slow = false;
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				if (this.slow) {
					now += 1000;
				}
				return super.getAppState(targetPid, options);
			}
		}
		const computer = new SlowComputer();
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);
		const baselineCalls = computer.stateOptions.length;
		computer.slow = true;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: {
					app: "Finder",
					observation_token: token,
					checks: [{ element_index: "20", value: "missing" }],
					timeout_ms: 20,
				},
			}),
		);

		expect(computer.stateOptions).toHaveLength(baselineCalls + 1);
		expect(payload["verified"]).toBe(false);
		// The in-flight AX walk is not raced or cancelled; deadline-aware AX walk budgets are a deferred seam.
	});

	it("does not start a wait observation after the instant-read deadline expires", async () => {
		const computer = new FakeGuardedComputer();
		const harness = await createHarness(computer, async () => []);
		closeHarness = harness.close;
		const token = await observe(harness);
		const baselineCalls = computer.stateOptions.length;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [{ type: "wait_for", window_title: "Missing", timeout_ms: 20 }],
				},
			}),
		);

		expect(computer.stateOptions).toHaveLength(baselineCalls + 2);
		expect(payload["runSteps"]).toMatchObject({ stoppedEarly: true });
	});
});

describe("#given a verification title check #when a slow observation crosses the deadline #then no window probe starts", () => {
	it("answers from the observed title instead of querying the window list after the deadline", async () => {
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		class SlowComputer extends FakeGuardedComputer {
			slow = false;
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				if (this.slow) {
					now += 1000;
				}
				return super.getAppState(targetPid, options);
			}
		}
		const computer = new SlowComputer();
		let probeCalls = 0;
		const harness = await createHarness(computer, async () => {
			probeCalls += 1;
			return [];
		});
		closeHarness = harness.close;
		const token = await observe(harness);
		probeCalls = 0;
		computer.slow = true;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "verify_state",
				arguments: { app: "Finder", observation_token: token, window_title: "Missing", timeout_ms: 20 },
			}),
		);

		expect(probeCalls).toBe(0);
		expect(payload["verified"]).toBe(false);
		expect(JSON.stringify(payload["checks"])).toContain("window list not queried: deadline expired");
	});
});

describe("#given a slow bound-window listing #when a wait starts #then no observation starts after the deadline", () => {
	it("stops before the observation when resolving the bound window spends the whole budget", async () => {
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		class RecordingComputer extends FakeGuardedComputer {
			readonly observationStarts: number[] = [];
			lastPid = 1234;
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				this.observationStarts.push(now);
				this.lastPid = targetPid;
				return super.getAppState(targetPid, options);
			}
		}
		const computer = new RecordingComputer();
		const windowProbe = async (): Promise<readonly TopLevelWindow[]> => {
			now += 1000;
			return [
				{
					id: computer.windowId,
					ownerPid: computer.lastPid,
					ownerName: "Finder",
					title: "Documents",
					bounds: { x: 0, y: 0, width: 100, height: 100 },
				},
			];
		};
		const harness = await createHarness(computer, windowProbe);
		closeHarness = harness.close;
		// Observing one listed window binds it, so the wait's next read resolves that window before observing.
		const observed = jsonPayload(
			await harness.client.callTool({ name: "get_app_state", arguments: { app: "Finder", window_id: 71 } }),
		);
		const token = String(observed["observation_token"]);
		const baselineStarts = computer.observationStarts.length;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [{ type: "wait_for", window_title: "Missing", timeout_ms: 20 }],
				},
			}),
		);

		// The wait itself reads nothing after the listing spends its 20 ms budget; the batch's own post-step read is
		// the single remaining observation, and a wait that had observed too would leave a second start behind it.
		const starts = computer.observationStarts.slice(baselineStarts);
		expect(starts).toHaveLength(1);
		expect(starts[0]).toBeGreaterThanOrEqual(20);
		expect(payload["runSteps"]).toMatchObject({ stoppedEarly: true });
		expect(JSON.stringify(payload["runSteps"])).toContain("1000 ms");
	});
});

describe("#given the observed window title matches #when a batch waits for it #then no window probe runs", () => {
	it("satisfies the wait from app state without probing windows", async () => {
		class TitledComputer extends FakeGuardedComputer {
			override async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
				return { ...(await super.getAppState(targetPid, options)), windowTitle: "Documents" };
			}
		}
		let probeCalls = 0;
		const windowProbe = async (): Promise<readonly TopLevelWindow[]> => {
			probeCalls += 1;
			return [];
		};
		const harness = await createHarness(new TitledComputer(), windowProbe);
		closeHarness = harness.close;
		const token = await observe(harness);
		probeCalls = 0;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_steps",
				arguments: {
					app: "Finder",
					observation_token: token,
					steps: [{ type: "wait_for", window_title: "Documents", timeout_ms: 100 }],
				},
			}),
		);

		expect(payload["runSteps"]).toMatchObject({
			stoppedEarly: false,
			steps: [{ type: "wait_for", status: "satisfied" }],
		});
		// run_steps probes before and after the batch; a wait-local probe would add a third call.
		expect(probeCalls).toBe(2);
	});
});
