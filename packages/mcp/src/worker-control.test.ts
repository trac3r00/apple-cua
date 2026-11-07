import { describe, expect, it } from "bun:test";
import { GuardedSession } from "./guarded-session.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import type { RunStep } from "./tool-schemas.js";
import { WorkerCoordinator } from "./worker-coordinator.js";

const typeThenSubmit: readonly RunStep[] = [
	{ type: "type_text", text: "first" },
	{ type: "press_keys", keys: ["return"] },
];

async function twoWorkers() {
	const computer = new FakeGuardedComputer();
	computer.delivery = "background";
	const coordinator = new WorkerCoordinator(new GuardedSession(computer), computer);
	const [notes, calculator] = await coordinator.assign([
		{ worker_id: "notes", task: "write", app: "Finder" },
		{ worker_id: "calculator", task: "add", app: "Other" },
	]);
	if (notes?.observation_token === undefined || calculator?.observation_token === undefined) {
		throw new Error("missing worker tokens");
	}
	return { computer, coordinator, notesToken: notes.observation_token, calculatorToken: calculator.observation_token };
}

describe("WorkerCoordinator #given a running worker #when the user takes over #then its remaining steps send no input", () => {
	it("cancels the in-flight run after the current step and refuses new runs until resume", async () => {
		const { computer, coordinator, notesToken } = await twoWorkers();
		try {
			computer.inputGate = async () => {
				coordinator.pause("notes");
			};

			const run = await coordinator.run("notes", notesToken, typeThenSubmit, undefined);
			const text = run.result.content.find((item) => item.type === "text");
			if (text?.type !== "text") throw new Error("missing run result");

			expect(JSON.parse(text.text)).toMatchObject({ runSteps: { stoppedEarly: true } });
			expect(computer.targetedInputs.map(({ effect }) => effect.kind)).toEqual(["type"]);
			expect(coordinator.status().find((worker) => worker.worker_id === "notes")?.control).toBe("paused");
			if (run.observation_token === undefined) throw new Error("paused run returned no fresh token");
			await expect(coordinator.run("notes", run.observation_token, typeThenSubmit, undefined)).rejects.toThrow(
				/took over worker "notes"/,
			);

			computer.inputGate = undefined;
			expect(coordinator.resume("notes")).toBe("running");
			await coordinator.run("notes", run.observation_token, typeThenSubmit, undefined);
			expect(computer.targetedInputs.map(({ effect }) => effect.kind)).toEqual(["type", "type", "key"]);
		} finally {
			await coordinator.close();
		}
	});
});

describe("WorkerCoordinator #given two workers #when the user stops one #then the other keeps working", () => {
	it("refuses runs, observations and resume for the stopped worker only", async () => {
		const { computer, coordinator, notesToken, calculatorToken } = await twoWorkers();
		try {
			expect(coordinator.stop("notes")).toBe("stopped");

			await expect(coordinator.run("notes", notesToken, typeThenSubmit, undefined)).rejects.toThrow(
				/stopped worker "notes"/,
			);
			await expect(coordinator.observe("notes")).rejects.toThrow(/stopped worker "notes"/);
			expect(() => coordinator.resume("notes")).toThrow(/stopped worker "notes"/);
			expect(() => coordinator.pause("notes")).toThrow(/stopped worker "notes"/);

			await coordinator.run("calculator", calculatorToken, [{ type: "type_text", text: "2+2" }], undefined);
			expect(computer.targetedInputs.map(({ effect }) => effect.kind)).toEqual(["type"]);
			coordinator.release("notes");
			expect(coordinator.status().map((worker) => worker.worker_id)).toEqual(["calculator"]);
		} finally {
			await coordinator.close();
		}
	});
});
