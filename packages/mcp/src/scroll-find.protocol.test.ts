import type { StopStatus, StopStatusSource } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import type { Effect } from "./protocol-test-harness.js";

class MutableStop implements StopStatusSource {
	state: StopStatus = { stopped: false };

	stop(): void {
		this.state = { stopped: true, stoppedAt: "2026-01-01T00:00:00.000Z", reason: "test", source: "chord" };
	}

	status(): StopStatus {
		return this.state;
	}
}

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function listComputer(
	rowCount: number,
	options: { readonly virtualized?: boolean; readonly visibleRows?: number } = {},
): FakeGuardedComputer {
	const computer = new FakeGuardedComputer();
	computer.scrollList = {
		rows: Array.from({ length: rowCount }, (_, index) => `row-${String(index).padStart(2, "0")}`),
		visibleRows: options.visibleRows ?? 5,
		virtualized: options.virtualized ?? true,
	};
	return computer;
}

async function start(computer: FakeGuardedComputer, stopSwitch?: StopStatusSource) {
	const harness = await createHarness(
		computer,
		undefined,
		undefined,
		stopSwitch === undefined ? undefined : { stopSwitch },
	);
	closeHarness = harness.close;
	return { harness, token: await observe(harness) };
}

interface StepReport {
	readonly status: string;
	readonly reason?: string;
	readonly route?: string;
	readonly found?: {
		readonly found_by?: string;
		readonly pages_scrolled: number;
		readonly scrolled_into_view?: boolean;
		readonly vision: string;
		readonly matched_text?: string;
	};
}
interface RunStepsReport {
	readonly stoppedEarly: boolean;
	readonly completed: number;
	readonly refused?: string;
	readonly tree_reads?: number;
	readonly steps: readonly StepReport[];
}

async function runFast(
	setup: Awaited<ReturnType<typeof start>>,
	steps: readonly Record<string, unknown>[],
): Promise<RunStepsReport> {
	const payload = jsonPayload(
		await setup.harness.client.callTool({
			name: "run_steps",
			arguments: { app: "Finder", observation_token: setup.token, steps, pace: "fast" },
		}),
	);
	return payload["runSteps"] as RunStepsReport;
}

const pageScrolls = (effects: readonly Effect[]): Effect[] =>
	effects.filter((effect) => effect.kind === "performAction" && effect.action.endsWith("ByPage"));
const clicks = (effects: readonly Effect[]): Effect[] => effects.filter((effect) => effect.kind === "click");
/** Reads that walk the whole window: only the up-front freshness read asks for an 80 ms settle. */
const fullReads = (computer: FakeGuardedComputer): number =>
	computer.stateOptions.filter((options) => options?.settleMs === 80).length;
const probeReads = (computer: FakeGuardedComputer): number =>
	computer.stateOptions.filter((options) => options?.probe === true).length;

/** Screen centre of the row `rowsFromTop` rows below the top of the list area (window 1000x800 at 300,150; 2x). */
function rowCentre(rowsFromTop: number): { x: number; y: number } {
	return { x: 300 + (10 + 100) * 2, y: 150 + (100 + rowsFromTop * 20 + 10) * 2 };
}

function clickPoint(effect: Effect | undefined): { x: number; y: number } {
	return effect?.kind === "click" ? effect.point : { x: Number.NaN, y: Number.NaN };
}

describe("scroll-until-found #given a list longer than its window #when a click names a row below the fold #then it pages until the row shows", () => {
	it("finds a virtualized row after N pages, reading only the scroll area and clicking the row's centre", async () => {
		const setup = await start(listComputer(40));

		const report = await runFast(setup, [
			{ type: "click", target: { text: "row-23" }, find: { vision: "off", max_pages: 10 } },
		]);

		expect(report.steps[0]).toMatchObject({
			status: "dispatched",
			found: { found_by: "accessibility", pages_scrolled: 4, vision: "off" },
		});
		expect(pageScrolls(setup.harness.computer.effects)).toHaveLength(4);
		const point = clickPoint(clicks(setup.harness.computer.effects)[0]);
		expect(point.x).toBeCloseTo(rowCentre(3).x, 3);
		expect(point.y).toBeCloseTo(rowCentre(3).y, 3);
		// One cheap read of just the scroll area per page, and no whole-window read in between.
		expect(probeReads(setup.harness.computer)).toBe(4);
		expect(fullReads(setup.harness.computer)).toBe(0);
		expect(report.tree_reads).toBe(0);
	});

	it("stops at the end of the content and names near misses instead of scrolling to the page budget", async () => {
		const setup = await start(listComputer(12));

		const report = await runFast(setup, [
			{ type: "click", target: { text: "row 99" }, find: { vision: "off", max_pages: 30 } },
		]);

		expect(report.stoppedEarly).toBe(true);
		expect(report.steps[0]).toMatchObject({
			status: "skipped",
			reason: expect.stringContaining("reached the end of the content"),
			found: { pages_scrolled: 3 },
		});
		expect(report.steps[0]?.reason).toContain("Near misses:");
		expect(clicks(setup.harness.computer.effects)).toHaveLength(0);
	});

	it("gives up at max_pages when the content keeps moving", async () => {
		const setup = await start(listComputer(60));

		const report = await runFast(setup, [
			{ type: "click", target: { text: "row 99" }, find: { vision: "off", max_pages: 2 } },
		]);

		expect(report.steps[0]).toMatchObject({
			status: "skipped",
			reason: expect.stringContaining("max_pages reached"),
			found: { pages_scrolled: 2 },
		});
		expect(pageScrolls(setup.harness.computer.effects)).toHaveLength(2);
	});

	it("refuses to scroll on once the stop switch is thrown between pages", async () => {
		const stop = new MutableStop();
		const computer = listComputer(40);
		computer.onScrollPage = (pages) => {
			if (pages === 2) {
				stop.stop();
			}
		};
		const setup = await start(computer, stop);

		const report = await runFast(setup, [
			{ type: "click", target: { text: "row-39" }, find: { vision: "off", max_pages: 20 } },
		]);

		expect(report.refused).toBe("user-stopped");
		expect(report.completed).toBe(0);
		expect(pageScrolls(computer.effects)).toHaveLength(2);
		expect(clicks(computer.effects)).toHaveLength(0);
	});
});

describe("scroll-until-found #given a list that exposes every row #when the target is clipped #then it is brought into view", () => {
	it("performs AXScrollToVisible on the element and clicks where it settled, without paging or re-reading", async () => {
		const computer = listComputer(40, { virtualized: false });
		computer.scrollIntoViewAdvertised = true;
		const setup = await start(computer);

		const report = await runFast(setup, [{ type: "click", target: { text: "row-30" }, find: { vision: "off" } }]);

		expect(report.steps[0]).toMatchObject({
			status: "dispatched",
			found: { found_by: "accessibility", pages_scrolled: 0, scrolled_into_view: true },
		});
		expect(computer.effects.some((effect) => effect.kind === "scrollIntoView")).toBe(true);
		expect(pageScrolls(computer.effects)).toHaveLength(0);
		expect(clickPoint(clicks(computer.effects)[0]).y).toBeCloseTo(rowCentre(0).y, 3);
		expect(probeReads(computer)).toBe(0);
	});

	it("pages toward the element by its distance when it does not advertise the action, re-reading only its frame", async () => {
		const computer = listComputer(40, { virtualized: false });
		const setup = await start(computer);

		const report = await runFast(setup, [{ type: "click", target: { text: "row-30" }, find: { vision: "off" } }]);

		expect(report.steps[0]).toMatchObject({ status: "dispatched", found: { pages_scrolled: 6 } });
		expect(pageScrolls(computer.effects)).toHaveLength(6);
		expect(probeReads(computer)).toBe(0);
		expect(clickPoint(clicks(computer.effects)[0]).y).toBeCloseTo(rowCentre(0).y, 3);
	});
});

describe("scroll-until-found #given accessibility cannot see the rows #when vision is allowed #then the window's text is read", () => {
	it("clicks the centre of text found by vision when accessibility has no match", async () => {
		const computer = listComputer(20);
		computer.axHidesRows = true;
		const setup = await start(computer);

		const report = await runFast(setup, [{ type: "click", target: { text: "row-03" }, find: {} }]);

		expect(report.steps[0]).toMatchObject({
			status: "dispatched",
			route: "synthetic_events",
			found: { found_by: "vision", matched_text: "row-03", pages_scrolled: 0, vision: "used" },
		});
		expect(report.steps[0]).not.toHaveProperty("resolved_element");
		const point = clickPoint(clicks(computer.effects)[0]);
		expect(point.x).toBeCloseTo(rowCentre(3).x, 3);
		expect(point.y).toBeCloseTo(rowCentre(3).y, 3);
	});

	it("scrolls and reads pixels only with vision only, ignoring accessibility matches", async () => {
		const computer = listComputer(20, { virtualized: false });
		const setup = await start(computer);

		const report = await runFast(setup, [
			{ type: "click", target: { text: "row-07" }, find: { vision: "only", max_pages: 5 } },
		]);

		expect(report.steps[0]).toMatchObject({
			status: "dispatched",
			found: { found_by: "vision", pages_scrolled: 1, matched_text: "row-07" },
		});
		expect(computer.effects.some((effect) => effect.kind === "performAction" && effect.action === "AXPress")).toBe(
			false,
		);
		expect(clickPoint(clicks(computer.effects)[0]).y).toBeCloseTo(rowCentre(2).y, 3);
	});

	it("skips vision with the reason when Screen Recording is not granted and searches by accessibility only", async () => {
		const computer = listComputer(8);
		computer.axHidesRows = true;
		computer.screenCaptureDenied = true;
		const setup = await start(computer);

		const report = await runFast(setup, [{ type: "click", target: { text: "row-03" }, find: {} }]);

		expect(report.steps[0]).toMatchObject({
			status: "skipped",
			found: { vision: "skipped: screen-recording-permission" },
		});
		expect(clicks(computer.effects)).toHaveLength(0);
	});

	it("refuses vision only without the permission instead of falling back to accessibility", async () => {
		const computer = listComputer(8);
		computer.screenCaptureDenied = true;
		const setup = await start(computer);

		const report = await runFast(setup, [{ type: "click", target: { text: "row-03" }, find: { vision: "only" } }]);

		expect(report.steps[0]).toMatchObject({
			status: "skipped",
			reason: expect.stringContaining("screen-recording-permission"),
			found: { pages_scrolled: 0 },
		});
		expect(clicks(computer.effects)).toHaveLength(0);
	});

	it("will not act on vision-only text with a step that needs an element", async () => {
		const computer = listComputer(20);
		computer.axHidesRows = true;
		const setup = await start(computer);

		const report = await runFast(setup, [
			{ type: "set_value", target: { text: "row-03" }, value: "x", find: { max_pages: 1 } },
		]);

		expect(report.steps[0]).toMatchObject({
			status: "skipped",
			reason: expect.stringContaining("cannot act on text found only in the window's pixels"),
		});
		expect(computer.effects.some((effect) => effect.kind === "setValue")).toBe(false);
	});
});

describe("scroll-until-found #given a fast chain of two far-away targets #when it runs #then the second is found after the first was clicked", () => {
	it("resolves each target right before its step, with no whole-window read and the cursor gliding between them", async () => {
		const computer = listComputer(40);
		const setup = await start(computer);

		const report = await runFast(setup, [
			{ type: "click", target: { text: "row-12" }, find: { vision: "off" } },
			{ type: "click", target: { text: "row-30" }, modifiers: ["command"], find: { vision: "off" } },
		]);

		expect(report).toMatchObject({ completed: 2, stoppedEarly: false, tree_reads: 0 });
		expect(report.steps[1]).toMatchObject({ status: "dispatched", found: { pages_scrolled: 4 } });
		// Order matters: scroll to the first, click it, then scroll on to the second and click that.
		const kinds = computer.effects
			.filter(
				(effect) =>
					effect.kind === "click" || (effect.kind === "performAction" && effect.action.endsWith("ByPage")),
			)
			.map((effect) => effect.kind);
		expect(kinds).toEqual(["performAction", "performAction", "click", ...Array(4).fill("performAction"), "click"]);
		const [first, second] = clicks(computer.effects);
		expect(clickPoint(first).y).toBeCloseTo(rowCentre(2).y, 3);
		expect(clickPoint(second).y).toBeCloseTo(rowCentre(0).y, 3);
		expect(second).toMatchObject({ modifiers: ["command"] });
		expect(fullReads(computer)).toBe(0);
		// The drawn cursor was asked to glide to each target.
		const near = (target: { x: number; y: number }): boolean =>
			computer.pointerHints.some((hint) => Math.abs(hint.x - target.x) < 0.01 && Math.abs(hint.y - target.y) < 0.01);
		expect(near(rowCentre(2))).toBe(true);
		expect(near(rowCentre(0))).toBe(true);
	});
});
