import { describe, expect, it } from "bun:test";
import {
	type HistorySegmentEvents,
	type HistorySkillDetection,
	type HistoryStep,
	detectHistorySkillCandidates,
	isPeriodic,
} from "./history-skill-candidates.js";

const APPS = ["Safari", "Notes", "Mail"] as const;
const ACTIONS = ["switch", "shortcut", "type", "click"] as const;
const DETAILS = ["a", "b"] as const;

type AbstractStep = { readonly app: string; readonly action: (typeof ACTIONS)[number]; readonly detail: string };

function event(step: AbstractStep, second: number): Record<string, unknown> {
	const base = { timestamp: `2026-11-01T10:00:${String(second % 60).padStart(2, "0")}Z`, app: { name: step.app } };
	switch (step.action) {
		case "switch":
			return { ...base, kind: "window.changed", window: { title: step.detail } };
		case "shortcut":
			return { ...base, kind: "keyboard.shortcut", keyboard: { keyEquivalent: step.detail } };
		case "type":
			return { ...base, kind: "keyboard.text_input", keyboard: { text: "private-literal" } };
		case "click":
			return {
				...base,
				kind: "mouse.click",
				mouse: { button: "left", target: { role: "button", title: step.detail } },
			};
	}
}

function oracleStep(step: AbstractStep): HistoryStep {
	return { app: step.app, action: step.action, detail: step.action === "type" ? "" : step.detail };
}

const keyOf = (step: HistoryStep): string => `${step.app}|${step.action}|${step.detail}`;

function collapse(steps: readonly AbstractStep[]): HistoryStep[] {
	const out: HistoryStep[] = [];
	for (const step of steps.map(oracleStep)) {
		const last = out.at(-1);
		if (last === undefined || keyOf(last) !== keyOf(step)) out.push(step);
	}
	return out;
}

function naiveCount(sequence: readonly string[], pattern: readonly string[]): number {
	let count = 0;
	let index = 0;
	while (index + pattern.length <= sequence.length) {
		if (pattern.every((key, offset) => sequence[index + offset] === key)) {
			count += 1;
			index += pattern.length;
		} else {
			index += 1;
		}
	}
	return count;
}

function contains(outer: readonly string[], inner: readonly string[]): boolean {
	return naiveCount(outer, inner) > 0 || (inner.length === 0 && outer.length === 0);
}

const informative = (step: HistoryStep): boolean => step.action !== "type" && step.detail !== "";
const periodic = (keys: readonly string[], minOverlap: number): boolean => {
	for (let period = 1; keys.length - period >= minOverlap; period += 1) {
		if (keys.slice(period).every((key, index) => key === keys[index])) return true;
	}
	return false;
};
const diverse = (steps: readonly HistoryStep[]): boolean =>
	steps.every((step) => step.action === "switch")
		? new Set(steps.filter(informative).map(keyOf)).size >= 3
		: new Set(steps.map((step) => step.app)).size >= 2 || new Set(steps.filter(informative).map(keyOf)).size >= 2;
const cyclicRun = (inner: readonly string[], cycle: readonly string[]): boolean =>
	contains(Array.from({ length: Math.ceil(inner.length / cycle.length) + 1 }, () => cycle).flat(), inner);

function violations(
	segments: readonly { readonly id: string; readonly steps: readonly HistoryStep[] }[],
	detection: HistorySkillDetection,
	bounds: { readonly minSteps: number; readonly maxSteps: number },
): string[] {
	const problems: string[] = [];
	const sequences = segments.map((segment) => ({ id: segment.id, keys: segment.steps.map(keyOf) }));
	const total = (pattern: readonly string[]) =>
		sequences.reduce((sum, sequence) => sum + naiveCount(sequence.keys, pattern), 0);
	for (const candidate of detection.candidates) {
		const pattern = candidate.steps.map(keyOf);
		if (pattern.length < bounds.minSteps || pattern.length > bounds.maxSteps)
			problems.push(`length ${pattern.length}`);
		const expected = total(pattern);
		if (expected !== candidate.occurrences) problems.push(`occurrences ${candidate.occurrences} != ${expected}`);
		if (candidate.occurrences < 2) problems.push("fewer than two occurrences");
		if (!diverse(candidate.steps)) problems.push("not meaningful");
		if (periodic(pattern, bounds.minSteps)) problems.push("periodic");
		const holders = sequences
			.filter((sequence) => naiveCount(sequence.keys, pattern) > 0)
			.map((sequence) => sequence.id);
		if (candidate.segmentIds.some((id) => !holders.includes(id))) problems.push("segment without occurrence");
		if (JSON.stringify(candidate).includes("private-literal")) problems.push("typed text leaked");
	}
	for (const sequence of sequences) {
		for (let length = bounds.minSteps; length <= bounds.maxSteps; length += 1) {
			for (let start = 0; start + length <= sequence.keys.length; start += 1) {
				const pattern = sequence.keys.slice(start, start + length);
				const count = total(pattern);
				const steps =
					segments.find((segment) => segment.id === sequence.id)?.steps.slice(start, start + length) ?? [];
				if (count < 2 || !diverse(steps) || periodic(pattern, bounds.minSteps)) continue;
				const covered = detection.candidates.some(
					(candidate) =>
						(candidate.occurrences >= count && contains(candidate.steps.map(keyOf), pattern)) ||
						(candidate.occurrences + 1 >= count && cyclicRun(pattern, candidate.steps.map(keyOf))),
				);
				if (!covered) problems.push(`missed repeated workflow ${pattern.join(" > ")} x${count}`);
			}
		}
	}
	return problems;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(random: () => number, values: readonly T[]): T {
	const value = values[Math.floor(random() * values.length)];
	if (value === undefined) throw new Error("empty choice");
	return value;
}

function generate(random: () => number): { abstract: AbstractStep[][]; segments: HistorySegmentEvents[] } {
	const planted: AbstractStep[] = Array.from({ length: 3 + Math.floor(random() * 3) }, () => ({
		app: pick(random, APPS),
		action: pick(random, ACTIONS),
		detail: pick(random, DETAILS),
	}));
	const segmentCount = Math.floor(random() * 4);
	const abstract: AbstractStep[][] = [];
	for (let index = 0; index < segmentCount; index += 1) {
		const steps: AbstractStep[] = [];
		const length = Math.floor(random() * 18);
		for (let position = 0; position < length; position += 1) {
			if (random() < 0.15) steps.push(...planted);
			else steps.push({ app: pick(random, APPS), action: pick(random, ACTIONS), detail: pick(random, DETAILS) });
		}
		abstract.push(steps);
	}
	const segments = abstract.map((steps, index) => ({
		id: `2026-11-01T10-${String(index).padStart(2, "0")}-00Z`,
		events: steps.map((step, second) => event(step, second)),
	}));
	return { abstract, segments };
}

describe("#given a copy-paste workflow repeated three times #when detecting #then one inline candidate is returned", () => {
	it("returns the workflow with occurrences, apps and no typed text", () => {
		const flow: AbstractStep[] = [
			{ app: "Safari", action: "switch", detail: "Invoice 1042" },
			{ app: "Safari", action: "shortcut", detail: "c" },
			{ app: "Notes", action: "switch", detail: "Ledger" },
			{ app: "Notes", action: "type", detail: "" },
			{ app: "Notes", action: "shortcut", detail: "v" },
		];
		const noise: AbstractStep = { app: "Mail", action: "click", detail: "Inbox" };
		const segments = [
			{ id: "2026-11-01T10-00-00Z", events: [...flow, noise, ...flow].map(event) },
			{ id: "2026-11-01T10-10-00Z", events: [noise, ...flow].map(event) },
		];
		const result = detectHistorySkillCandidates(segments);
		expect(result.candidates[0]?.occurrences).toBe(3);
		expect(result.candidates[0]?.steps.map((step) => step.action)).toEqual([
			"switch",
			"shortcut",
			"switch",
			"type",
			"shortcut",
		]);
		expect(result.candidates[0]?.steps[0]?.detail).toBe("invoice #");
		expect(result.candidates[0]?.apps).toEqual(["Notes", "Safari"]);
		expect(result.candidates[0]?.proposedName).toBe("safari-notes-workflow");
		expect(result.candidates[0]?.segmentIds).toEqual(["2026-11-01T10-00-00Z", "2026-11-01T10-10-00Z"]);
		expect(JSON.stringify(result)).not.toContain("private-literal");
	});
});

describe("#given only overlapping repeats #when detecting #then no candidate is claimed", () => {
	it("does not count A>B>A twice inside A>B>A>B>A", () => {
		const a: AbstractStep = { app: "Safari", action: "click", detail: "a" };
		const b: AbstractStep = { app: "Notes", action: "click", detail: "b" };
		const result = detectHistorySkillCandidates([{ id: "s", events: [a, b, a, b, a].map(event) }], {
			minSteps: 3,
			maxSteps: 3,
		});
		expect(result.candidates).toEqual([]);
	});
});

describe("#given a repeat split across a segment boundary #when detecting #then it is not joined", () => {
	it("keeps segments separate", () => {
		const flow: AbstractStep[] = [
			{ app: "Safari", action: "switch", detail: "x" },
			{ app: "Notes", action: "switch", detail: "y" },
			{ app: "Mail", action: "switch", detail: "z" },
		];
		const segments = [
			{ id: "1", events: [...flow, flow[0], flow[1]].map((step, index) => event(step as AbstractStep, index)) },
			{ id: "2", events: [flow[2]].map((step, index) => event(step as AbstractStep, index)) },
		];
		expect(detectHistorySkillCandidates(segments).candidates).toEqual([]);
	});
});

describe("#given malformed events #when detecting #then they are skipped and counted, never thrown", () => {
	it("counts each invalid family", () => {
		const invalid: unknown[] = [
			null,
			"text",
			[],
			{},
			{ kind: "window.changed" },
			{ kind: "window.changed", timestamp: "t", app: { name: "" } },
			{ kind: "window.changed", timestamp: "t", app: "Safari" },
			{ kind: "unknown.kind", timestamp: "t", app: { name: "Safari" } },
		];
		const result = detectHistorySkillCandidates([{ id: "s", events: invalid }]);
		expect(result).toEqual({ candidates: [], scannedSegments: 1, scannedEvents: invalid.length, skippedEvents: 8 });
	});
});

describe("#given empty and boundary inputs #when detecting #then results are empty but well-formed", () => {
	it("handles no segments, empty segments and the event budget", () => {
		expect(detectHistorySkillCandidates([]).candidates).toEqual([]);
		expect(detectHistorySkillCandidates([{ id: "s", events: [] }]).scannedSegments).toBe(1);
		const flow: AbstractStep[] = [
			{ app: "Safari", action: "switch", detail: "x" },
			{ app: "Notes", action: "switch", detail: "y" },
			{ app: "Mail", action: "switch", detail: "z" },
		];
		const events = [...flow, ...flow].map(event);
		expect(detectHistorySkillCandidates([{ id: "s", events }], { maxEvents: 4 }).candidates).toEqual([]);
		expect(detectHistorySkillCandidates([{ id: "s", events }], { maxEvents: 6 }).candidates).toHaveLength(1);
	});
});

describe("#given the oracle #when fed a corrupted detection #then it reports the violation (calibration)", () => {
	it("rejects inflated counts, typed-text leaks and invented segments", () => {
		const flow: AbstractStep[] = [
			{ app: "Safari", action: "switch", detail: "x" },
			{ app: "Notes", action: "switch", detail: "y" },
			{ app: "Mail", action: "switch", detail: "z" },
		];
		const segments = [{ id: "s", events: [...flow, ...flow].map(event) }];
		const model = [{ id: "s", steps: collapse([...flow, ...flow]) }];
		const bounds = { minSteps: 3, maxSteps: 12 };
		const good = detectHistorySkillCandidates(segments);
		expect(violations(model, good, bounds)).toEqual([]);
		const first = good.candidates[0];
		if (first === undefined) throw new Error("expected a candidate");
		const inflated = { ...good, candidates: [{ ...first, occurrences: first.occurrences + 1 }] };
		const leaked = { ...good, candidates: [{ ...first, description: "private-literal" }] };
		const invented = { ...good, candidates: [{ ...first, segmentIds: ["other"] }] };
		const missing = { ...good, candidates: [] };
		expect(violations(model, inflated, bounds).join()).toContain("occurrences");
		expect(violations(model, leaked, bounds).join()).toContain("typed text leaked");
		expect(violations(model, invented, bounds).join()).toContain("segment without occurrence");
		expect(violations(model, missing, bounds).join()).toContain("missed repeated workflow");
	});
});

describe("#given seeded generated histories #when detecting #then every result matches the brute-force model", () => {
	it("passes the bounded property campaign (seed 20261101, 400 cases)", () => {
		const seed = 20261101;
		const random = mulberry32(seed);
		const bounds = { minSteps: 3, maxSteps: 6 };
		const counts = { attempted: 0, executed: 0, discarded: 0, failing: 0, withCandidates: 0, empty: 0 };
		const failures: string[] = [];
		for (let index = 0; index < 400; index += 1) {
			counts.attempted += 1;
			const { abstract, segments } = generate(random);
			const model = abstract.map((steps, position) => ({
				id: segments[position]?.id ?? "",
				steps: collapse(steps),
			}));
			const detection = detectHistorySkillCandidates(segments, { ...bounds, limit: 10_000 });
			const reversed = detectHistorySkillCandidates([...segments].reverse(), { ...bounds, limit: 10_000 });
			const problems = violations(model, detection, bounds);
			if (JSON.stringify(reversed) !== JSON.stringify(detection)) problems.push("order dependent");
			counts.executed += 1;
			if (detection.candidates.length > 0) counts.withCandidates += 1;
			else counts.empty += 1;
			if (problems.length > 0) {
				counts.failing += 1;
				failures.push(`case ${index}: ${problems.slice(0, 3).join("; ")}`);
			}
		}
		expect(failures.slice(0, 5)).toEqual([]);
		expect(counts.executed).toBe(400);
		expect(counts.withCandidates).toBeGreaterThan(50);
		expect(counts.empty).toBeGreaterThan(20);
	}, 30_000);
});

describe("#given a single-app loop of bare clicks and typing #when detecting #then it is not suggested", () => {
	it("rejects click/type/switch loops that name nothing, but keeps a titled multi-step one", () => {
		const loop: AbstractStep[] = [
			{ app: "Herdr", action: "click", detail: "" },
			{ app: "Herdr", action: "type", detail: "" },
			{ app: "Herdr", action: "switch", detail: "herdr" },
		];
		const noise = (index: number) => event({ app: "Herdr", action: "click", detail: `n${index}` }, index);
		const repeated = [...loop, ...loop, ...loop].map(event);
		expect(detectHistorySkillCandidates([{ id: "s", events: [...repeated, noise(1)] }]).candidates).toEqual([]);
		const titled: AbstractStep[] = [
			{ app: "Herdr", action: "switch", detail: "inbox" },
			{ app: "Herdr", action: "shortcut", detail: "r" },
			{ app: "Herdr", action: "type", detail: "" },
		];
		const result = detectHistorySkillCandidates([{ id: "s", events: [...titled, ...titled].map(event) }]);
		expect(result.candidates[0]?.occurrences).toBe(2);
	});
});

describe("#given someone moving back and forth between apps #when detecting #then it is not suggested as a workflow", () => {
	it("drops untitled app switches but keeps switches through three titled windows", () => {
		const toggling: AbstractStep[] = [
			{ app: "Brave Browser", action: "switch", detail: "" },
			{ app: "Herdr", action: "switch", detail: "" },
		];
		const back = Array.from({ length: 8 }, () => toggling).flat();
		expect(detectHistorySkillCandidates([{ id: "s", events: back.map(event) }]).candidates).toEqual([]);
		const visit: AbstractStep[] = [
			{ app: "Safari", action: "switch", detail: "Invoice" },
			{ app: "Numbers", action: "switch", detail: "Ledger" },
			{ app: "Mail", action: "switch", detail: "Reply" },
		];
		const noise = event({ app: "Notes", action: "click", detail: "n" }, 0);
		const result = detectHistorySkillCandidates([
			{ id: "s", events: [...visit.map(event), noise, ...visit.map(event)] },
		]);
		expect(result.candidates[0]?.occurrences).toBe(2);
	});
});

describe("#given a workflow repeated back to back #when detecting #then only the single workflow is suggested, not its doubling", () => {
	it("drops periodic candidates such as the workflow repeated twice", () => {
		const flow: AbstractStep[] = [
			{ app: "Notes", action: "type", detail: "" },
			{ app: "Notes", action: "shortcut", detail: "c" },
			{ app: "Mail", action: "switch", detail: "draft" },
			{ app: "Mail", action: "shortcut", detail: "v" },
		];
		const steps = [...flow, ...flow, ...flow, ...flow];
		const result = detectHistorySkillCandidates([{ id: "s", events: steps.map(event) }], { maxSteps: 12 });
		expect(result.candidates.map((candidate) => candidate.steps.length)).toEqual([4]);
		expect(result.candidates[0]?.occurrences).toBe(4);
		expect(isPeriodic(["a", "b", "c", "a", "b"], 2)).toBe(true);
		expect(isPeriodic(["a", "b", "c", "a"], 2)).toBe(false);
	});
});
