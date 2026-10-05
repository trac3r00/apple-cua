import type { AppState } from "@apple-cua/core";
import { describe, expect, it, vi } from "vitest";
import { buildMacActionSpace } from "./action-space.js";
import type { ExecutionResult, Observation, PlatformAdapter } from "./adapter.js";
import type { Decider } from "./decision.js";
import { DecisionAgent } from "./loop.js";
import type { Decision, DecisionOutcome } from "./types.js";

function state(elements: AppState["elements"]): AppState {
	return {
		app: "TextEdit",
		bundleId: "com.apple.TextEdit",
		pid: 42,
		frontmost: false,
		axAvailable: true,
		elements,
		screenshotBase64: "",
		screenshotWidth: 0,
		screenshotHeight: 0,
		display: { width: 1920, height: 1080, scaleFactor: 2 },
		observationKey: "1:key",
	};
}

const saveButton = {
	id: 0,
	role: "AXButton",
	label: "Save",
	value: null,
	frame: { x: 10, y: 10, width: 40, height: 24 },
	actions: ["AXPress"],
	children: [],
};

function adapterWith(
	current: AppState,
	execute: (decision: Decision) => Promise<ExecutionResult>,
): PlatformAdapter<AppState> {
	return {
		platform: "macos",
		async observe(): Promise<Observation<AppState>> {
			return { space: buildMacActionSpace(current), state: current };
		},
		execute: async (_observation, decision) => await execute(decision),
	};
}

function deciderReturning(decision: Partial<Decision>): Decider {
	return async (): Promise<DecisionOutcome> => ({
		ok: true,
		decision: {
			operation: "PRESS",
			confidence: 1,
			blockedProbability: 0,
			goalSatisfiedProbability: 0,
			risk: 0,
			riskClass: "reversible_ui",
			answers: {},
			...decision,
		},
	});
}

const ran: ExecutionResult = { status: "ran", route: "accessibility", detail: "pressed Save" };

describe("DecisionAgent guards", () => {
	it("#given a consequential decision and no approver #when the step runs #then nothing is executed", async () => {
		const execute = vi.fn(async () => ran);
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), execute),
			goal: "delete everything",
			decide: deciderReturning({ risk: 0.9, riskClass: "deletes_or_overwrites" }),
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("needs-approval");
		expect(execute).not.toHaveBeenCalled();
	});

	it("#given a consequential decision and an approver that agrees #when the step runs #then it executes", async () => {
		const execute = vi.fn(async () => ran);
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), execute),
			goal: "delete everything",
			decide: deciderReturning({ risk: 0.9, riskClass: "deletes_or_overwrites" }),
			approve: () => true,
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("ran");
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("#given a DONE claim with no verifier #when the step runs #then it is refused rather than accepted", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({ operation: "DONE", goalSatisfiedProbability: 0.99 }),
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("refused");
		expect(record.detail).toMatch(/no verifier/);
	});

	it("#given a DONE claim the verifier confirms #when the step runs #then the run is done", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({ operation: "DONE", goalSatisfiedProbability: 0.99 }),
			verify: () => true,
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("done");
	});

	it("#given a DONE claim the verifier rejects #when the step runs #then it is refused", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({ operation: "DONE", goalSatisfiedProbability: 0.99 }),
			verify: () => false,
		});

		expect((await agent.decideOnce()).status).toBe("refused");
	});

	it("#given a DONE claim below the threshold #when the step runs #then it is refused", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({ operation: "DONE", goalSatisfiedProbability: 0.4 }),
			verify: () => true,
		});

		expect((await agent.decideOnce()).status).toBe("refused");
	});

	it("#given a step that satisfies the goal #when the verifier confirms it afterwards #then the run ends as done without waiting for the model to say so", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({}),
			verify: () => true,
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("done");
		expect(record.detail).toMatch(/verifier confirmed/);
	});

	it("#given a step the verifier does not accept #when the step runs #then it reports the execution and keeps going", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({}),
			verify: () => false,
		});

		expect((await agent.decideOnce()).status).toBe("ran");
	});

	it("#given a low-confidence choice #when the step runs #then nothing is executed", async () => {
		const execute = vi.fn(async () => ran);
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), execute),
			goal: "save the note",
			decide: deciderReturning({ confidence: 0.1 }),
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("refused");
		expect(execute).not.toHaveBeenCalled();
	});

	it("#given a screen that looks blocked #when the step runs #then the run stops as blocked", async () => {
		const execute = vi.fn(async () => ran);
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), execute),
			goal: "save the note",
			decide: deciderReturning({ blockedProbability: 0.95 }),
		});

		expect((await agent.decideOnce()).status).toBe("blocked");
		expect(execute).not.toHaveBeenCalled();
	});

	it("#given a sparse screen #when the step runs #then it stops instead of guessing", async () => {
		const decide = vi.fn(deciderReturning({}));
		const agent = new DecisionAgent({
			adapter: adapterWith(state([]), async () => ran),
			goal: "save the note",
			decide,
		});

		const record = await agent.decideOnce();

		expect(record.status).toBe("blocked");
		expect(decide).not.toHaveBeenCalled();
	});

	it("#given TYPE_TEXT with no text provider #when the step runs #then it reports needs-text and executes nothing", async () => {
		const execute = vi.fn(async () => ran);
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), execute),
			goal: "write the note",
			decide: deciderReturning({ operation: "TYPE_TEXT" }),
			textProvider: () => null,
		});

		expect((await agent.decideOnce()).status).toBe("needs-text");
		expect(execute).not.toHaveBeenCalled();
	});
});

describe("DecisionAgent run", () => {
	it("#given three steps that change nothing #when the run continues #then it stops as stalled", async () => {
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => ran),
			goal: "save the note",
			decide: deciderReturning({}),
			maxDecisions: 10,
		});

		const statuses: string[] = [];
		for await (const record of agent.run()) {
			statuses.push(record.status);
		}

		expect(statuses).toStrictEqual(["ran", "ran", "ran", "ran", "stalled"]);
	});

	it("#given a run that reaches its operation budget #when the loop asks again #then it stops as blocked", async () => {
		let calls = 0;
		const agent = new DecisionAgent({
			adapter: adapterWith(state([saveButton]), async () => {
				calls += 1;
				return {
					status: "ran",
					route: "accessibility",
					detail: `pressed ${calls}`,
				};
			}),
			goal: "keep pressing",
			decide: deciderReturning({}),
			maxOperations: 2,
		});

		const statuses: string[] = [];
		for await (const record of agent.run()) {
			statuses.push(record.status);
		}

		expect(statuses).toStrictEqual(["ran", "ran", "blocked"]);
	});
});
