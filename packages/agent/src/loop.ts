import type { PlatformAdapter } from "./adapter.js";
import type { Observation } from "./adapter.js";
import type { Decider, HistoryEntry } from "./decision.js";
import { CONFIDENCE_FLOOR, DONE_THRESHOLD, MAX_DECISIONS, MAX_OPERATIONS, RISK_THRESHOLD } from "./questions.js";
import type { ActionSpace, Decision } from "./types.js";

export type StepStatus =
	| "ran"
	| "refused"
	| "failed"
	| "needs-approval"
	| "needs-text"
	| "done"
	| "blocked"
	| "stalled";

export interface StepRecord {
	readonly step: number;
	readonly status: StepStatus;
	readonly detail: string;
	readonly space: ActionSpace;
	readonly decision?: Decision;
	readonly elapsedMs: number;
}

export interface DecisionAgentOptions<TState> {
	readonly adapter: PlatformAdapter<TState>;
	readonly goal: string;
	readonly decide: Decider;
	/**
	 * Called with a decision whose risk reached the threshold. Returning true runs it; anything else
	 * leaves it unrun and reports `needs-approval`. Without a handler, nothing above the threshold runs.
	 */
	readonly approve?: (decision: Decision) => boolean | Promise<boolean>;
	/**
	 * Independent check of a `DONE`. Returning false rejects it, undefined means it cannot be judged.
	 * Without one, `DONE` is only the model's claim and the loop does not treat it as success.
	 */
	readonly verify?: (state: TState) => boolean | undefined | Promise<boolean | undefined>;
	/** Supplies the value for `TYPE_TEXT`. The decision model chooses, it does not compose prose. */
	readonly textProvider?: (context: { readonly goal: string; readonly space: ActionSpace }) =>
		| string
		| null
		| Promise<string | null>;
	readonly riskThreshold?: number;
	readonly doneThreshold?: number;
	readonly confidenceFloor?: number;
	readonly blockedThreshold?: number;
	readonly maxOperations?: number;
	readonly maxDecisions?: number;
	readonly allowSparse?: boolean;
	/** Accept `DONE` on the model's probability alone. Off by default: a claim is not a verification. */
	readonly acceptUnverifiedDone?: boolean;
}

const BLOCKED_THRESHOLD = 0.8;
const STALL_LIMIT = 3;

export class DecisionAgent<TState> {
	private readonly options: DecisionAgentOptions<TState>;
	private readonly history: HistoryEntry[] = [];
	private readonly records: StepRecord[] = [];
	private executed = 0;
	private decisions = 0;
	private unchanged = 0;
	private fingerprint = "";

	constructor(options: DecisionAgentOptions<TState>) {
		this.options = options;
	}

	get steps(): readonly StepRecord[] {
		return this.records;
	}

	async decideOnce(): Promise<StepRecord> {
		const started = Date.now();
		const observation = await this.options.adapter.observe();
		const space = observation.space;

		if (space.sparse && this.options.allowSparse !== true) {
			return this.record({
				status: "blocked",
				detail: "the screen exposed almost nothing to choose from",
				space,
				started,
			});
		}

		const outcome = await this.options.decide({ space, goal: this.options.goal, history: this.history });
		this.decisions += 1;
		if (!outcome.ok) {
			return this.record({
				status: "refused",
				detail: `${outcome.refusal.reason}: ${outcome.refusal.detail}`,
				space,
				started,
			});
		}
		const decision = outcome.decision;

		if (decision.blockedProbability >= (this.options.blockedThreshold ?? BLOCKED_THRESHOLD)) {
			return this.record({
				status: "blocked",
				detail: `the screen looks blocked (${decision.blockedProbability.toFixed(2)})`,
				space,
				decision,
				started,
			});
		}

		if (decision.operation === "DONE") {
			return await this.finish(observation, decision, started);
		}

		if (decision.operation === "BLOCKED") {
			return this.record({
				status: "blocked",
				detail: "no offered operation can make progress",
				space,
				decision,
				started,
			});
		}

		if (decision.confidence < (this.options.confidenceFloor ?? CONFIDENCE_FLOOR)) {
			return this.record({
				status: "refused",
				detail: `the choice is not confident enough to run (${decision.confidence.toFixed(2)})`,
				space,
				decision,
				started,
			});
		}

		if (decision.risk >= (this.options.riskThreshold ?? RISK_THRESHOLD)) {
			const approved = (await this.options.approve?.(decision)) ?? false;
			if (!approved) {
				return this.record({
					status: "needs-approval",
					detail: `${decision.riskClass} at risk ${decision.risk.toFixed(2)}: ${describe(decision)}`,
					space,
					decision,
					started,
				});
			}
		}

		const runnable = await this.withText(space, decision);
		if (runnable === undefined) {
			return this.record({
				status: "needs-text",
				detail: "TYPE_TEXT needs a value and no text provider supplied one",
				space,
				decision,
				started,
			});
		}

		const execution = await this.options.adapter.execute(observation, runnable);
		if (execution.status === "ran") {
			this.executed += 1;
		}
		this.history.push({
			operation: runnable.operation,
			...(runnable.target === undefined ? {} : { target: runnable.target.label }),
			outcome: execution.status,
		});
		this.trackProgress(space);

		// Success is decided by reading the screen afterwards, never by the model's own report. When
		// the caller supplies an oracle it runs here, so a run ends the moment the goal is actually
		// met instead of waiting for a decision model to volunteer that it is.
		if (execution.status === "ran" && this.options.verify !== undefined) {
			const after = await this.options.adapter.observe();
			if ((await this.options.verify(after.state)) === true) {
				return this.record({
					status: "done",
					detail: "the verifier confirmed the goal after this operation",
					space: after.space,
					decision: runnable,
					started,
				});
			}
		}

		return this.record({ status: execution.status, detail: execution.detail, space, decision: runnable, started });
	}

	async *run(): AsyncGenerator<StepRecord> {
		for (;;) {
			if (this.executed >= (this.options.maxOperations ?? MAX_OPERATIONS)) {
				yield this.terminal(
					"blocked",
					`reached the ${this.options.maxOperations ?? MAX_OPERATIONS}-operation budget`,
				);
				return;
			}
			if (this.decisions >= (this.options.maxDecisions ?? MAX_DECISIONS)) {
				yield this.terminal("blocked", `reached the ${this.options.maxDecisions ?? MAX_DECISIONS}-decision budget`);
				return;
			}
			if (this.unchanged >= STALL_LIMIT) {
				yield this.terminal("stalled", `${STALL_LIMIT} operations in a row changed nothing on screen`);
				return;
			}
			const record = await this.decideOnce();
			yield record;
			if (record.status !== "ran" && record.status !== "failed") {
				return;
			}
		}
	}

	private async finish(observation: Observation<TState>, decision: Decision, started: number): Promise<StepRecord> {
		if (decision.goalSatisfiedProbability < (this.options.doneThreshold ?? DONE_THRESHOLD)) {
			return this.record({
				status: "refused",
				detail: `DONE is not well enough supported (${decision.goalSatisfiedProbability.toFixed(2)})`,
				space: observation.space,
				decision,
				started,
			});
		}
		const verification = await this.options.verify?.(observation.state);
		if (verification === false) {
			return this.record({
				status: "refused",
				detail: "the verifier rejected DONE",
				space: observation.space,
				decision,
				started,
			});
		}
		if (verification === undefined && this.options.acceptUnverifiedDone !== true) {
			return this.record({
				status: "refused",
				detail: "DONE was claimed but no verifier confirmed it",
				space: observation.space,
				decision,
				started,
			});
		}
		return this.record({
			status: "done",
			detail:
				verification === undefined ? "the goal looks satisfied (unverified)" : "the goal is satisfied and verified",
			space: observation.space,
			decision,
			started,
		});
	}

	private async withText(space: ActionSpace, decision: Decision): Promise<Decision | undefined> {
		if (decision.operation !== "TYPE_TEXT") {
			return decision;
		}
		const text = await this.options.textProvider?.({ goal: this.options.goal, space });
		if (text === null || text === undefined || text === "") {
			return undefined;
		}
		return { ...decision, text };
	}

	private trackProgress(space: ActionSpace): void {
		const next = JSON.stringify([space.elements, space.visibleText]);
		if (next === this.fingerprint) {
			this.unchanged += 1;
			return;
		}
		this.fingerprint = next;
		this.unchanged = 0;
	}

	private record(input: {
		readonly status: StepStatus;
		readonly detail: string;
		readonly space: ActionSpace;
		readonly started: number;
		readonly decision?: Decision;
	}): StepRecord {
		const record: StepRecord = {
			step: this.records.length + 1,
			status: input.status,
			detail: input.detail,
			space: input.space,
			elapsedMs: Date.now() - input.started,
			...(input.decision === undefined ? {} : { decision: input.decision }),
		};
		this.records.push(record);
		return record;
	}

	private terminal(status: StepStatus, detail: string): StepRecord {
		const space = this.records[this.records.length - 1]?.space ?? emptySpace(this.options.adapter.platform);
		return this.record({ status, detail, space, started: Date.now() });
	}
}

function describe(decision: Decision): string {
	const target = decision.target;
	return target === undefined ? decision.operation : `${decision.operation} ${target.label}`;
}

function emptySpace(platform: "macos" | "ios"): ActionSpace {
	return {
		platform,
		app: "",
		elements: [],
		visibleText: [],
		targets: {},
		operations: [],
		truncated: false,
		pruned: 0,
		sparse: true,
	};
}
