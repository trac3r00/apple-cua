import { createHash } from "node:crypto";

/**
 * Local, model-free detection of repeated workflows in recorded history.
 *
 * Input is untrusted recorded data. Typed text is never copied into a step; only the fact that
 * text was typed. A candidate is a contiguous step sequence that occurs at least `minOccurrences`
 * times without overlapping, never across a segment boundary.
 */

export type HistoryStepAction = "switch" | "shortcut" | "type" | "click";

export interface HistoryStep {
	readonly app: string;
	readonly action: HistoryStepAction;
	readonly detail: string;
}

export interface HistorySegmentEvents {
	readonly id: string;
	readonly events: readonly unknown[];
}

export interface HistorySkillCandidate {
	readonly id: string;
	readonly proposedName: string;
	readonly description: string;
	readonly occurrences: number;
	readonly apps: readonly string[];
	readonly steps: readonly HistoryStep[];
	readonly segmentIds: readonly string[];
	readonly lastSeenAt: string;
}

export interface HistorySkillDetection {
	readonly candidates: readonly HistorySkillCandidate[];
	readonly scannedSegments: number;
	readonly scannedEvents: number;
	readonly skippedEvents: number;
}

export interface HistorySkillDetectionOptions {
	readonly minSteps?: number;
	readonly maxSteps?: number;
	readonly minOccurrences?: number;
	readonly limit?: number;
	readonly maxEvents?: number;
}

const MAX_DETAIL = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDetail(value: unknown): string {
	if (typeof value !== "string") return "";
	const collapsed = value.replace(/\s+/g, " ").trim().toLowerCase().replace(/\d+/g, "#");
	return [...collapsed].slice(0, MAX_DETAIL).join("");
}

interface ParsedEvent {
	readonly step: HistoryStep;
	readonly timestamp: string;
}

export function historyEventToStep(event: unknown): ParsedEvent | undefined | "invalid" {
	if (!isRecord(event) || typeof event["kind"] !== "string" || typeof event["timestamp"] !== "string") {
		return "invalid";
	}
	const kind = event["kind"];
	if (kind === "session.started" || kind === "selection.changed") return undefined;
	const app = event["app"];
	if (!isRecord(app) || typeof app["name"] !== "string" || app["name"].trim().length === 0) return "invalid";
	const appName = app["name"].trim();
	const timestamp = event["timestamp"];
	const window = isRecord(event["window"]) ? event["window"] : undefined;
	if (kind === "window.changed") {
		return { timestamp, step: { app: appName, action: "switch", detail: normalizeDetail(window?.["title"]) } };
	}
	if (kind === "keyboard.shortcut") {
		const keyboard = isRecord(event["keyboard"]) ? event["keyboard"] : undefined;
		return {
			timestamp,
			step: { app: appName, action: "shortcut", detail: normalizeDetail(keyboard?.["keyEquivalent"]) },
		};
	}
	if (kind === "keyboard.text_input") {
		return { timestamp, step: { app: appName, action: "type", detail: "" } };
	}
	if (kind === "mouse.click" || kind === "mouse.drag") {
		const mouse = isRecord(event["mouse"]) ? event["mouse"] : undefined;
		const target = isRecord(mouse?.["target"]) ? mouse["target"] : undefined;
		const label = normalizeDetail(target?.["title"] ?? target?.["description"] ?? target?.["role"]);
		return { timestamp, step: { app: appName, action: "click", detail: label } };
	}
	return "invalid";
}

function stepKey(step: HistoryStep): string {
	return `${step.app}\u0000${step.action}\u0000${step.detail}`;
}

export function historyStepsForSegment(events: readonly unknown[]): {
	readonly steps: readonly HistoryStep[];
	readonly timestamps: readonly string[];
	readonly skipped: number;
} {
	const steps: HistoryStep[] = [];
	const timestamps: string[] = [];
	let skipped = 0;
	for (const event of events) {
		const parsed = historyEventToStep(event);
		if (parsed === "invalid") {
			skipped += 1;
			continue;
		}
		if (parsed === undefined) continue;
		const previous = steps.at(-1);
		if (previous !== undefined && stepKey(previous) === stepKey(parsed.step)) {
			timestamps[timestamps.length - 1] = parsed.timestamp;
			continue;
		}
		steps.push(parsed.step);
		timestamps.push(parsed.timestamp);
	}
	return { steps, timestamps, skipped };
}

/** Greedy left-to-right count of non-overlapping starts; starts must be sorted ascending. */
export function nonOverlappingStarts(starts: readonly number[], length: number): number[] {
	const chosen: number[] = [];
	let nextFree = Number.NEGATIVE_INFINITY;
	for (const start of starts) {
		if (start >= nextFree) {
			chosen.push(start);
			nextFree = start + length;
		}
	}
	return chosen;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function proposeName(steps: readonly HistoryStep[]): string {
	const apps = [...new Set(steps.map((step) => slug(step.app)).filter((part) => part.length > 0))].slice(0, 3);
	const base = apps.length === 0 ? "workflow" : `${apps.join("-")}-workflow`;
	const trimmed = base.slice(0, 64).replace(/-+$/g, "");
	return trimmed.length === 0 ? "workflow" : trimmed;
}

export function describeHistoryStep(step: HistoryStep): string {
	switch (step.action) {
		case "switch":
			return step.detail.length > 0 ? `switch to ${step.app} (${step.detail})` : `switch to ${step.app}`;
		case "shortcut":
			return step.detail.length > 0
				? `press the Command/Control shortcut "${step.detail}" in ${step.app}`
				: `press a Command/Control shortcut in ${step.app}`;
		case "type":
			return `type text in ${step.app}`;
		case "click":
			return step.detail.length > 0 ? `click "${step.detail}" in ${step.app}` : `click in ${step.app}`;
	}
}

function isInformative(step: HistoryStep): boolean {
	return step.action !== "type" && step.detail.length > 0;
}

/**
 * True when the sequence overlaps a shifted copy of itself by at least `minOverlap` steps, e.g. A>B>C>A>B for
 * minOverlap 2: it is a shorter workflow repeated, which that shorter candidate already represents.
 */
export function isPeriodic(keys: readonly string[], minOverlap = 1): boolean {
	for (let period = 1; keys.length - period >= minOverlap; period += 1) {
		let matches = true;
		for (let index = period; index < keys.length && matches; index += 1)
			matches = keys[index] === keys[index - period];
		if (matches) return true;
	}
	return false;
}

/** True when `inner` is a contiguous run of `cycle` repeated end to end (covers rotations and wrapped windows). */
function isCyclicRun(inner: readonly string[], cycle: readonly string[]): boolean {
	const repeats = Math.ceil(inner.length / cycle.length) + 1;
	return isContiguousSubsequence(inner, Array.from({ length: repeats }, () => cycle).flat());
}

/**
 * A workflow spans two apps, or names at least two distinct informative steps; bare click/type loops do not count.
 * Steps that only switch apps are someone moving between windows, not a workflow, unless they visit three distinct
 * titled windows.
 */
function isMeaningful(steps: readonly HistoryStep[]): boolean {
	if (steps.every((step) => step.action === "switch")) {
		return new Set(steps.filter(isInformative).map(stepKey)).size >= 3;
	}
	if (new Set(steps.map((step) => step.app)).size >= 2) return true;
	return new Set(steps.filter(isInformative).map(stepKey)).size >= 2;
}

function isContiguousSubsequence(inner: readonly string[], outer: readonly string[]): boolean {
	for (let start = 0; start + inner.length <= outer.length; start += 1) {
		if (inner.every((key, index) => outer[start + index] === key)) return true;
	}
	return false;
}

export function detectHistorySkillCandidates(
	segments: readonly HistorySegmentEvents[],
	options: HistorySkillDetectionOptions = {},
): HistorySkillDetection {
	const minSteps = Math.max(2, options.minSteps ?? 3);
	const maxSteps = Math.max(minSteps, options.maxSteps ?? 12);
	const minOccurrences = Math.max(2, options.minOccurrences ?? 2);
	const limit = Math.max(1, options.limit ?? 10);
	const maxEvents = Math.max(1, options.maxEvents ?? 50_000);

	const ordered = [...segments].sort((left, right) => left.id.localeCompare(right.id));
	const keys: (string | undefined)[] = [];
	const steps: (HistoryStep | undefined)[] = [];
	const owners: string[] = [];
	const times: string[] = [];
	let scannedEvents = 0;
	let skippedEvents = 0;
	for (const segment of ordered) {
		const remaining = maxEvents - scannedEvents;
		if (remaining <= 0) break;
		const events = segment.events.slice(0, remaining);
		scannedEvents += events.length;
		const parsed = historyStepsForSegment(events);
		skippedEvents += parsed.skipped;
		for (const [index, step] of parsed.steps.entries()) {
			keys.push(stepKey(step));
			steps.push(step);
			owners.push(segment.id);
			times.push(parsed.timestamps[index] ?? "");
		}
		// A sentinel stops any n-gram from spanning two segments.
		keys.push(undefined);
		steps.push(undefined);
		owners.push(segment.id);
		times.push("");
	}

	const interned = new Map<string, number>();
	const ids = keys.map((key) => {
		if (key === undefined) return undefined;
		let id = interned.get(key);
		if (id === undefined) {
			id = interned.size;
			interned.set(key, id);
		}
		return id;
	});
	type Gram = { readonly length: number; readonly starts: number[] };
	const grams = new Map<string, Gram>();
	for (let start = 0; start < ids.length; start += 1) {
		let gramId = "";
		for (let length = 1; length <= maxSteps && start + length <= ids.length; length += 1) {
			const id = ids[start + length - 1];
			if (id === undefined) break;
			gramId = length === 1 ? String(id) : `${gramId},${id}`;
			if (length < minSteps) continue;
			const gram = grams.get(gramId);
			if (gram === undefined) grams.set(gramId, { length, starts: [start] });
			else gram.starts.push(start);
		}
	}

	type Scored = {
		readonly keys: readonly string[];
		readonly starts: readonly number[];
		readonly steps: readonly HistoryStep[];
		readonly tie: string;
	};
	const scored: Scored[] = [];
	for (const gram of grams.values()) {
		if (gram.starts.length < minOccurrences) continue;
		const chosen = nonOverlappingStarts(gram.starts, gram.length);
		if (chosen.length < minOccurrences) continue;
		const first = chosen[0] ?? 0;
		const gramSteps = steps
			.slice(first, first + gram.length)
			.filter((step): step is HistoryStep => step !== undefined);
		if (!isMeaningful(gramSteps)) continue;
		const gramKeys = keys.slice(first, first + gram.length).filter((key): key is string => key !== undefined);
		if (isPeriodic(gramKeys, minSteps)) continue;
		scored.push({ keys: gramKeys, starts: chosen, steps: gramSteps, tie: gramKeys.join("\u0001") });
	}
	scored.sort(
		(left, right) =>
			right.starts.length * right.keys.length - left.starts.length * left.keys.length ||
			right.keys.length - left.keys.length ||
			(left.tie < right.tie ? -1 : left.tie > right.tie ? 1 : 0),
	);

	const accepted: Scored[] = [];
	for (const candidate of scored) {
		const subsumed = accepted.some(
			(existing) =>
				existing.starts.length >= candidate.starts.length && isContiguousSubsequence(candidate.keys, existing.keys),
		);
		const wrapped = accepted.some(
			(existing) =>
				existing.starts.length + 1 >= candidate.starts.length && isCyclicRun(candidate.keys, existing.keys),
		);
		if (subsumed || wrapped) continue;
		accepted.push(candidate);
		if (accepted.length >= limit) break;
	}

	const candidates = accepted.map((candidate): HistorySkillCandidate => {
		const segmentIds = [...new Set(candidate.starts.map((start) => owners[start] ?? ""))].sort();
		const lastStart = candidate.starts.at(-1) ?? 0;
		const apps = [...new Set(candidate.steps.map((step) => step.app))].sort();
		return {
			id: createHash("sha256").update(candidate.keys.join("\u0001")).digest("hex").slice(0, 12),
			proposedName: proposeName(candidate.steps),
			description: `Repeated ${candidate.starts.length} times: ${candidate.steps.map(describeHistoryStep).join(", then ")}.`,
			occurrences: candidate.starts.length,
			apps,
			steps: candidate.steps,
			segmentIds,
			lastSeenAt: times[lastStart + candidate.keys.length - 1] ?? "",
		};
	});

	return { candidates, scannedSegments: ordered.length, scannedEvents, skippedEvents };
}
