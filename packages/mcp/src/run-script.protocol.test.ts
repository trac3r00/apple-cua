import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";
import type { Effect } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	vi.useRealTimers();
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

async function start() {
	const harness = await createHarness();
	closeHarness = harness.close;
	return harness;
}

function inputEffects(effects: readonly Effect[]): Effect[] {
	return effects.filter((effect) => effect.kind !== "close");
}

describe("run_script #given an approved app #when a script loops over actions #then one call drives the whole flow", () => {
	it("runs every iteration through the guarded path and returns the script value", async () => {
		const harness = await start();

		const result = await harness.client.callTool({
			name: "run_script",
			arguments: {
				code: `
					const finder = apple.app("Finder");
					await finder.observe();
					const done = [];
					for (const [position, id] of [20, 21].entries()) {
						const answer = await finder.setValue(id, "value-" + position);
						done.push(answer.runSteps.steps[0].status);
					}
					return { done };
				`,
			},
		});
		const payload = jsonPayload(result);

		expect(result.isError).not.toBe(true);
		expect(payload).toMatchObject({ ok: true, value: { done: ["dispatched", "dispatched"] } });
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "value-0" },
			{ kind: "setValue", pid: 1234, id: 21, value: "value-1" },
		]);
		expect(payload["actions"]).toMatchObject([
			{ n: 1, app: "Finder", kind: "observe", status: "ok" },
			{ n: 2, app: "Finder", kind: "set_value" },
			{ n: 3, app: "Finder", kind: "set_value" },
		]);
		expect(payload["elapsedMs"]).toEqual(expect.any(Number));
	});

	it("reads a value and branches on it", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						const state = await finder.observe();
						const note = state.elements.find((element) => element.id === 20);
						if (note.value === "draft") {
							await finder.setValue(20, "published");
						} else {
							await finder.setValue(20, "unexpected");
						}
						return note.value;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: "draft" });
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "published" },
		]);
	});

	it("observes by itself for query targets and refuses element ids without an observation", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						let refused;
						try {
							await finder.click(9);
						} catch (error) {
							refused = error.refused;
						}
						await finder.click({ label: "Open" });
						return refused;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: "needs-observation" });
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
		]);
	});
});

describe("run_script #given a refused action #when the script catches or ignores it #then the refusal stays visible", () => {
	it("lets the script catch a ScriptActionError carrying the refusal payload", async () => {
		const harness = await start();
		harness.computer.preflightResult = { ok: false, reason: "window-changed" };

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						try {
							await finder.click(9);
						} catch (error) {
							return { name: error.name, kind: error.kind, refused: error.refused, dispatched: error.payload.actionDispatched };
						}
						return "not refused";
					`,
				},
			}),
		);

		expect(payload).toMatchObject({
			ok: true,
			value: { name: "ScriptActionError", kind: "refused", refused: "window-changed", dispatched: false },
		});
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("returns an error with the failed action and payload when the script does not catch it", async () => {
		const harness = await start();
		harness.computer.preflightResult = { ok: false, reason: "window-changed" };

		const result = await harness.client.callTool({
			name: "run_script",
			arguments: {
				code: `
					const finder = apple.app("Finder");
					await finder.observe();
					log("before");
					await finder.click(9);
					log("after");
				`,
			},
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			ok: false,
			kind: "action-failed",
			failedAction: { app: "Finder", kind: "click", status: "refused:window-changed" },
			payload: { actionDispatched: false, reason: "window-changed" },
			log: ["before"],
		});
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_script #given read_only #when the script mutates #then nothing is dispatched", () => {
	it("throws a read-only refusal before any input reaches the computer", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					read_only: true,
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						const refusals = [];
						for (const attempt of [() => finder.click(9), () => finder.type("x"), () => finder.setValue(20, "y")]) {
							try {
								await attempt();
							} catch (error) {
								refusals.push(error.refused);
							}
						}
						const checked = await finder.verify([{ element_index: 20, exists: true }]);
						return { refusals, verified: checked.verified };
					`,
				},
			}),
		);

		expect(payload).toMatchObject({
			ok: true,
			value: { refusals: ["read-only", "read-only", "read-only"], verified: true },
		});
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_script #given bad or slow code #when it runs #then the failure is reported as an error", () => {
	it("reports a syntax error without running anything", async () => {
		const harness = await start();

		const result = await harness.client.callTool({ name: "run_script", arguments: { code: "const = ;" } });

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({ ok: false, kind: "syntax-error", error: expect.any(String) });
		expect(harness.computer.stateOptions).toEqual([]);
	});

	it("reports a thrown script error with the log captured so far", async () => {
		const harness = await start();

		const result = await harness.client.callTool({
			name: "run_script",
			arguments: { code: `log("start"); throw new Error("boom");` },
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			ok: false,
			kind: "script-error",
			error: "Error: boom",
			log: ["start"],
		});
	});

	it("reports a timeout for an awaiting script and dispatches nothing afterwards", async () => {
		const harness = await start();

		const result = await harness.client.callTool({
			name: "run_script",
			arguments: {
				timeout_ms: 50,
				code: `
					const finder = apple.app("Finder");
					await finder.observe();
					await sleep(5000);
					await finder.setValue(20, "late");
				`,
			},
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({ ok: false, kind: "timeout" });
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("reports a timeout for a script that never yields", async () => {
		const harness = await start();

		const result = await harness.client.callTool({
			name: "run_script",
			arguments: { timeout_ms: 50, code: "while (true) {}" },
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({ ok: false, kind: "timeout" });
	});
});

describe("run_script #given log calls #when the script finishes #then the log is returned", () => {
	it("captures strings and JSON values in order and offers no process or require", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						log("hello", { a: 1 });
						console.log("from console", [1, 2]);
						return [typeof require, typeof process];
					`,
				},
			}),
		);

		expect(payload).toMatchObject({
			ok: true,
			value: ["undefined", "undefined"],
			log: ['hello {"a":1}', "from console [1,2]"],
		});
	});
});

/** Reads that walk the UI before dispatch: the pre-dispatch freshness read is the only one asking for an 80 ms settle. */
function preDispatchReads(harness: Awaited<ReturnType<typeof start>>): number {
	return harness.computer.stateOptions.filter((options) => options?.settleMs === 80).length;
}

describe("run_script #given consecutive query-target actions #when the outcome read is still fresh #then it stands in for the next pre-dispatch read", () => {
	it("resolves the next target against the previous outcome read without walking the UI again", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.click({ label: "Open" });
						await finder.click({ label: "Open" });
						await finder.click({ label: "Open" });
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(inputEffects(harness.computer.effects)).toHaveLength(3);
		expect(preDispatchReads(harness)).toBe(0);
		// One observe plus one outcome read per click: nothing else touched the accessibility tree.
		expect(harness.computer.stateOptions).toHaveLength(4);
	});

	it("finds a control that an earlier step created", async () => {
		const harness = await start();
		harness.computer.hiddenElementIds.add(9);
		harness.computer.onStateCall = () => {
			if (harness.computer.effects.length > 0) {
				harness.computer.hiddenElementIds.delete(9);
			}
		};

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.setValue({ label: "Note" }, "reveal");
						await finder.click({ label: "Open" });
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "reveal" },
			{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
		]);
		expect(preDispatchReads(harness)).toBe(0);
	});

	it("walks the UI again once the outcome read is older than the reuse bound", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const harness = await start();
		// Time passes between the first click's outcome read and the second click's preflight.
		const preflight = harness.computer.preflightInput.bind(harness.computer);
		let preflights = 0;
		harness.computer.preflightInput = async (expected, options) => {
			preflights += 1;
			if (preflights === 2) {
				vi.setSystemTime(Date.now() + 10_000);
			}
			return await preflight(expected, options);
		};

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.click({ label: "Open" });
						await finder.click({ label: "Open" });
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(inputEffects(harness.computer.effects)).toHaveLength(2);
		// Click 1 reuses the observe read; click 2 finds the outcome read of click 1 expired.
		expect(preDispatchReads(harness)).toBe(1);
	});

	it("walks the UI again when another observation replaced the one the token came from", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.click({ label: "Open" });
						await finder.find({ label: "Note" });
						await finder.click({ label: "Open" });
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(preDispatchReads(harness)).toBe(1);
	});

	it("never reuses a read that was cut short by the element budget", async () => {
		const harness = await start();
		harness.computer.elementsTruncated = true;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.click({ label: "Open" });
						await finder.click({ label: "Open" });
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(preDispatchReads(harness)).toBe(2);
	});
});

describe("run_script #given several steps #when the script batches them #then one guarded call runs them all", () => {
	it("dispatches every step through one run_steps call with a fresh read between steps", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						const answer = await finder.batch([
							apple.steps.setValue({ label: "Note" }, "one"),
							apple.steps.setValue({ label: "Status" }, "two"),
						]);
						return answer.runSteps.steps.map((step) => step.status);
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: ["dispatched", "dispatched"] });
		expect(payload["actions"]).toMatchObject([{ kind: "observe" }, { kind: "batch" }]);
		expect(inputEffects(harness.computer.effects)).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "one" },
			{ kind: "setValue", pid: 1234, id: 21, value: "two" },
		]);
		// The first target resolves against the observe read; the second must see what the first made of the UI.
		expect(preDispatchReads(harness)).toBe(1);
		// One preflight for the batch, and the window guard before its second step.
		expect(harness.computer.preflightExpected).toHaveLength(2);
	});

	it("stops the batch at the first step that cannot run and reports it", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.batch([
							apple.steps.setValue({ label: "Note" }, "one"),
							apple.steps.setValue({ label: "No such field" }, "two"),
							apple.steps.setValue({ label: "Status" }, "three"),
						]);
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: false, kind: "action-failed" });
		expect(inputEffects(harness.computer.effects)).toEqual([{ kind: "setValue", pid: 1234, id: 20, value: "one" }]);
	});

	it("refuses an empty batch and a non-step entry before dispatching anything", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						const refusals = [];
						for (const steps of [[], ["click"]]) {
							try {
								await finder.batch(steps);
							} catch (error) {
								refusals.push(error.refused);
							}
						}
						return refusals;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: ["invalid-argument", "invalid-argument"] });
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("honours read_only for batched mutations", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					read_only: true,
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.batch([apple.steps.setValue({ label: "Note" }, "one")]);
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: false, kind: "action-failed" });
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_script #given a waitFor whose condition holds #when it stands alone #then the script goes on", () => {
	it("answers the satisfied wait as confirmed instead of throwing it as refused", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						const waited = await finder.waitFor({ label: "Open" }, { timeoutMs: 500 });
						return { effect: waited.effect, status: waited.runSteps.steps[0].status };
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: { effect: "confirmed", status: "satisfied" } });
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_script #given a script that blocks its thread #when the deadline passes #then the worker is terminated and the server stays responsive", () => {
	it("terminates a busy loop that starts after an await while other tools keep answering", async () => {
		const harness = await start();
		let release: () => void = () => undefined;
		const observed = new Promise<void>((resolve) => {
			release = resolve;
		});
		harness.computer.onStateCall = () => release();
		// Only the run_script deadline is faked, so it cannot fire until the test advances it: the 20 rounds below
		// always run while the script is still running, however slow the machine is.
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		let settled = false;
		const script = harness.client
			.callTool({
				name: "run_script",
				arguments: {
					timeout_ms: 1500,
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await Promise.resolve();
						while (true) {}
					`,
				},
			})
			.finally(() => {
				settled = true;
			});

		await observed;
		for (let round = 0; round < 20; round++) {
			const apps = await harness.client.callTool({ name: "list_apps", arguments: {} });
			expect(apps.isError).not.toBe(true);
		}
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1500);
		const result = await script;
		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({ ok: false, kind: "timeout" });
		const after = await harness.client.callTool({ name: "list_apps", arguments: {} });
		expect(after.isError).not.toBe(true);
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});

	it("terminates a busy loop before any await and answers the next run_script at once", async () => {
		const harness = await start();

		const stuck = await harness.client.callTool({
			name: "run_script",
			arguments: { timeout_ms: 100, code: "while (true) {}" },
		});
		const next = jsonPayload(
			await harness.client.callTool({ name: "run_script", arguments: { code: "return 1 + 1;" } }),
		);

		expect(jsonPayload(stuck)).toMatchObject({ ok: false, kind: "timeout" });
		expect(next).toMatchObject({ ok: true, value: 2 });
	});

	it("keeps no state between runs", async () => {
		const harness = await start();

		await harness.client.callTool({
			name: "run_script",
			arguments: { code: "globalThis.leak = 1; Array.prototype.leak = 2;" },
		});
		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: { code: "return [typeof leak, typeof [].leak];" },
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: ["undefined", "undefined"] });
	});
});

describe("run_script #given a cancelled call #when an action is in flight #then no further action is dispatched", () => {
	it("stops the script at the cancelled action", async () => {
		const harness = await start();
		let enter: () => void = () => undefined;
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		let open: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			open = resolve;
		});
		const preflight = harness.computer.preflightInput.bind(harness.computer);
		harness.computer.preflightInput = async (expected, options) => {
			enter();
			await gate;
			return await preflight(expected, options);
		};
		const controller = new AbortController();
		const pending = harness.client.callTool(
			{
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						await finder.setValue(20, "first");
						await finder.setValue(21, "second");
					`,
				},
			},
			undefined,
			{ signal: controller.signal },
		);

		await entered;
		controller.abort();
		await expect(pending).rejects.toThrow();
		open();
		const barrier = jsonPayload(
			await harness.client.callTool({ name: "run_script", arguments: { code: "return 1;" } }),
		);

		expect(barrier).toMatchObject({ ok: true });
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});

describe("run_script #given errors raised across the worker boundary #when the script catches them #then they keep their shape", () => {
	it("catches argument errors raised in the script and non-cloneable arguments", async () => {
		const harness = await start();

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						await finder.observe();
						const caught = [];
						const attempts = [
							() => apple.app(""),
							() => apple.steps.click(-1),
							() => finder.step({ type: "click", element_index: "9", callback: () => 1 }),
							() => finder.step("click"),
						];
						for (const attempt of attempts) {
							try {
								await attempt();
								caught.push("no error");
							} catch (error) {
								caught.push([error.name, error.kind, error.refused]);
							}
						}
						return caught;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({
			ok: true,
			value: [
				["ScriptActionError", "invalid-argument", "invalid-argument"],
				["ScriptActionError", "invalid-argument", "invalid-argument"],
				["ScriptActionError", "invalid-argument", "invalid-argument"],
				["ScriptActionError", "invalid-argument", "invalid-argument"],
			],
		});
		expect(inputEffects(harness.computer.effects)).toEqual([]);
	});
});
