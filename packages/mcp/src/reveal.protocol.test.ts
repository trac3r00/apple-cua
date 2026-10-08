import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import type { Effect } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function listComputer(rowCount: number): FakeGuardedComputer {
	const computer = new FakeGuardedComputer();
	computer.scrollList = {
		rows: Array.from({ length: rowCount }, (_, index) => `row-${String(index).padStart(2, "0")}`),
		visibleRows: 5,
		virtualized: true,
	};
	return computer;
}

async function start(computer: FakeGuardedComputer) {
	const harness = await createHarness(computer);
	closeHarness = harness.close;
	return { harness, token: await observe(harness) };
}

interface StepReport {
	readonly status: string;
	readonly reason?: string;
	readonly input_dispatched?: boolean;
	readonly found?: { readonly found_by?: string; readonly pages_scrolled: number };
}
interface RunStepsReport {
	readonly stoppedEarly: boolean;
	readonly steps: readonly StepReport[];
}

async function runSteps(
	setup: Awaited<ReturnType<typeof start>>,
	steps: readonly Record<string, unknown>[],
): Promise<RunStepsReport> {
	const payload = jsonPayload(
		await setup.harness.client.callTool({
			name: "run_steps",
			arguments: { app: "Finder", observation_token: setup.token, steps },
		}),
	);
	return payload["runSteps"] as RunStepsReport;
}

const isPageScroll = (effect: Effect): boolean => effect.kind === "performAction" && effect.action.endsWith("ByPage");
const pageScrolls = (effects: readonly Effect[]): Effect[] => effects.filter(isPageScroll);
/** Everything the target could have been touched with: any effect that is not scrolling the list itself. */
const targetActions = (effects: readonly Effect[]): Effect[] =>
	effects.filter((effect) => effect.kind !== "close" && effect.kind !== "scrollIntoView" && !isPageScroll(effect));

describe("reveal #given a row below the fold #when run_steps reveals it #then it pages to it and acts on nothing", () => {
	it("scrolls the list until the row shows and sends no click, edit, or press to it", async () => {
		const setup = await start(listComputer(40));

		const report = await runSteps(setup, [
			{ type: "reveal", target: { text: "row-23" }, find: { vision: "off", max_pages: 10 } },
		]);

		expect(report.steps[0]).toMatchObject({
			status: "dispatched",
			found: { found_by: "accessibility", pages_scrolled: 4 },
		});
		expect(pageScrolls(setup.harness.computer.effects)).toHaveLength(4);
		expect(targetActions(setup.harness.computer.effects)).toEqual([]);
	});

	it("succeeds without scrolling or input when the row is already visible", async () => {
		const setup = await start(listComputer(40));

		const report = await runSteps(setup, [{ type: "reveal", target: { text: "row-02" }, find: { vision: "off" } }]);

		expect(report.steps[0]).toMatchObject({ status: "dispatched", found: { pages_scrolled: 0 } });
		expect(pageScrolls(setup.harness.computer.effects)).toHaveLength(0);
		expect(targetActions(setup.harness.computer.effects)).toEqual([]);
	});

	it("applies the bounded default find when find is omitted", async () => {
		const setup = await start(listComputer(60));

		const report = await runSteps(setup, [{ type: "reveal", target: { text: "row-99" } }]);

		expect(report.stoppedEarly).toBe(true);
		expect(report.steps[0]).toMatchObject({ status: "skipped", found: { pages_scrolled: 10 } });
		expect(pageScrolls(setup.harness.computer.effects)).toHaveLength(10);
		expect(targetActions(setup.harness.computer.effects)).toEqual([]);
	});

	it("gives up when the page budget is too small to reach the row", async () => {
		const setup = await start(listComputer(40));

		const report = await runSteps(setup, [
			{ type: "reveal", target: { text: "row-23" }, find: { vision: "off", max_pages: 2 } },
		]);

		expect(report.stoppedEarly).toBe(true);
		expect(report.steps[0]).toMatchObject({ status: "skipped", found: { pages_scrolled: 2 } });
		expect(targetActions(setup.harness.computer.effects)).toEqual([]);
	});

	it("reveals text that only the window's pixels show, without pointer input", async () => {
		const computer = listComputer(20);
		computer.axHidesRows = true;
		const setup = await start(computer);

		const report = await runSteps(setup, [{ type: "reveal", target: { text: "row-03" } }]);

		expect(report.steps[0]).toMatchObject({ status: "dispatched", found: { found_by: "vision" } });
		expect(targetActions(computer.effects)).toEqual([]);
	});

	it("rejects a reveal without a target and fields that would act on one", async () => {
		const setup = await start(listComputer(10));
		const call = async (step: Record<string, unknown>) =>
			await setup.harness.client.callTool({
				name: "run_steps",
				arguments: { app: "Finder", observation_token: setup.token, steps: [step] },
			});

		for (const step of [
			{ type: "reveal" },
			{ type: "reveal", target: { text: "row-03" }, click_count: 2 },
			{ type: "reveal", target: { text: "row-03" }, value: "x" },
		]) {
			const result = await call(step);
			expect(result.isError).toBe(true);
		}
		expect(targetActions(setup.harness.computer.effects)).toEqual([]);
	});
});

describe("reveal #given run_script #when app.reveal or apple.steps.reveal runs #then it navigates and never acts on the target", () => {
	it("app.reveal pages to the row and returns the find evidence", async () => {
		const computer = listComputer(40);
		const setup = await start(computer);

		const payload = jsonPayload(
			await setup.harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const answer = await apple.app("Finder").reveal({ text: "row-23" }, { vision: "off", maxPages: 10 });
						return answer.runSteps.steps[0].found.pages_scrolled;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: 4 });
		expect(payload["actions"]).toMatchObject([
			{ app: "Finder", kind: "observe" },
			{ app: "Finder", kind: "reveal" },
		]);
		expect(pageScrolls(computer.effects)).toHaveLength(4);
		expect(targetActions(computer.effects)).toEqual([]);
	});

	it("apple.steps.reveal builds a step that app.batch runs", async () => {
		const computer = listComputer(40);
		const setup = await start(computer);

		const payload = jsonPayload(
			await setup.harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `
						const finder = apple.app("Finder");
						const answer = await finder.batch([apple.steps.reveal({ text: "row-23" }, { vision: "off" })]);
						return answer.runSteps.steps[0].status;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: "dispatched" });
		expect(targetActions(computer.effects)).toEqual([]);
	});

	it("is a navigation mutation: read_only refuses it before anything is dispatched", async () => {
		const computer = listComputer(40);
		const setup = await start(computer);

		const payload = jsonPayload(
			await setup.harness.client.callTool({
				name: "run_script",
				arguments: {
					read_only: true,
					code: `
						let refused;
						try {
							await apple.app("Finder").reveal({ text: "row-23" });
						} catch (error) {
							refused = error.refused;
						}
						return refused;
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true, value: "read-only" });
		expect(pageScrolls(computer.effects)).toHaveLength(0);
		expect(targetActions(computer.effects)).toEqual([]);
	});

	it("refuses an element id, since a reveal has to look for a described target", async () => {
		const setup = await start(listComputer(10));

		const payload = jsonPayload(
			await setup.harness.client.callTool({
				name: "run_script",
				arguments: { code: `await apple.app("Finder").reveal(9);` },
			}),
		);

		expect(payload).toMatchObject({ ok: false });
		expect(targetActions(setup.harness.computer.effects)).toEqual([]);
	});
});
