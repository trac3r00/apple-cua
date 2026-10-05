import { BLOCKED, GOAL_SATISFIED, NEXT_OPERATION, RISK_CLASS, RISK_SCORE, TARGET } from "./questions.js";
import { RISK_CLASSES, TARGETED_OPERATIONS } from "./types.js";
import type {
	ActionSpace,
	Decision,
	DecisionOutcome,
	DecisionRefusal,
	Operation,
	RiskClass,
	Target,
	TargetedOperation,
} from "./types.js";

const OPERATION_DESCRIPTIONS: Readonly<Record<Operation, string>> = {
	PRESS: "Press or tap a listed element: a button, checkbox, row, tab, link, or disclosure triangle.",
	TYPE_TEXT: "Replace the whole contents of a listed editable field.",
	SCROLL_UP: "Scroll the main content up.",
	SCROLL_DOWN: "Scroll the main content down.",
	PRESS_RETURN: "Press Return, to commit the focused field or accept a dialog.",
	PRESS_ESCAPE: "Press Escape, to dismiss an open menu, popover, or sheet.",
	WAIT: "Wait briefly for the interface to settle.",
	DONE: "Every requirement is visibly satisfied on the current screen.",
	BLOCKED: "No offered operation can make progress.",
};

const RISK_CLASS_DESCRIPTIONS: Readonly<Record<RiskClass, string>> = {
	reversible_ui: "Interface state that can be undone: focus, scroll, a view option, typing in a field.",
	changes_document: "Changes a saved document or file the task itself is working on.",
	changes_setting: "Changes a system-wide or account-wide setting that outlives this task.",
	sends_or_publishes: "Sends a message or mail, posts publicly, or otherwise contacts someone.",
	deletes_or_overwrites: "Deletes or overwrites data the task did not create.",
	grants_or_signs_in: "Grants a permission, signs in, or changes account or privacy state.",
	installs_or_pays: "Installs or removes software, submits payment, or submits personal data.",
};

/** The risk score is answered on a five-level scale, so each level is a quarter of the 0-1 range. */
const RISK_LEVELS = [
	"Reversible interface state: moving focus, scrolling, typing into a field, toggling a view option.",
	"Changes how something is displayed or arranged, with nothing saved.",
	"Changes a saved document or a setting, but nothing leaves the machine.",
	"Contacts someone, publishes, signs in, or grants a permission.",
	"Deletes or overwrites data, installs software, or submits payment or personal data.",
];

const RISK_LEVEL_SPAN = RISK_LEVELS.length - 1;

export interface DecisionConfig {
	/** An OpenAI-compatible chat endpoint that speaks the `{state, questions}` decision contract. */
	readonly endpoint: string;
	readonly model: string;
	readonly apiKey?: string;
	readonly timeoutMs?: number;
	readonly fetchImpl?: typeof fetch;
	/** How many recent actions travel with the state. Enough to see a loop, short enough to stay cheap. */
	readonly maxRecentActions?: number;
}

export interface HistoryEntry {
	readonly operation: Operation;
	readonly target?: string;
	readonly outcome: "ran" | "refused" | "failed";
}

export interface DecisionRequest {
	readonly space: ActionSpace;
	readonly goal: string;
	readonly history: readonly HistoryEntry[];
}

export type Decider = (request: DecisionRequest) => Promise<DecisionOutcome>;

type Question =
	| { readonly type: "choice"; readonly instructions: string; readonly criteria: Record<string, string> }
	| { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] }
	| { readonly type: "noul"; readonly instructions: string };

interface Answer {
	readonly choice?: unknown;
	readonly score?: unknown;
	readonly noul?: unknown;
	readonly confidence?: unknown;
}

/**
 * One request asks which operation to run, which target each targeted operation would use, how
 * consequential it is, and whether the screen is blocked or already finished. Only the head matching
 * the chosen operation can execute, so the rest costs a few tokens and no extra round trip.
 */
export function createDecider(config: DecisionConfig): Decider {
	const doFetch = config.fetchImpl ?? fetch;
	const timeoutMs = config.timeoutMs ?? 30_000;
	const maxRecent = config.maxRecentActions ?? 8;
	return async (request: DecisionRequest): Promise<DecisionOutcome> => {
		const questions = questionsFor(request.space);
		const state = stateFor(request, maxRecent);
		const body = {
			model: config.model,
			temperature: 0,
			messages: [{ role: "user", content: JSON.stringify({ state, questions }) }],
		};
		const headers: Record<string, string> = { "content-type": "application/json" };
		if (config.apiKey !== undefined && config.apiKey !== "") {
			headers["authorization"] = `Bearer ${config.apiKey}`;
		}
		const response = await doFetch(config.endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`decision endpoint returned HTTP ${response.status}: ${text.slice(0, 300)}`);
		}
		return validate(answersOf(text), request.space);
	};
}

export function questionsFor(space: ActionSpace): Record<string, Question> {
	const questions: Record<string, Question> = {
		operation: {
			type: "choice",
			instructions: NEXT_OPERATION,
			criteria: Object.fromEntries(
				space.operations.map((operation) => [operation, OPERATION_DESCRIPTIONS[operation]]),
			),
		},
		risk: { type: "score", instructions: RISK_SCORE, criteria: RISK_LEVELS },
		risk_class: { type: "choice", instructions: RISK_CLASS, criteria: RISK_CLASS_DESCRIPTIONS },
		blocked: { type: "noul", instructions: BLOCKED },
		goal_satisfied: { type: "noul", instructions: GOAL_SATISFIED },
	};
	for (const operation of TARGETED_OPERATIONS) {
		const targets = space.targets[operation];
		if (targets === undefined) {
			continue;
		}
		questions[targetQuestion(operation)] = {
			type: "choice",
			instructions: TARGET,
			criteria: Object.fromEntries(
				Object.values(targets).map((target) => [String(target.index), `${target.role} ${target.label}`.trim()]),
			),
		};
	}
	return questions;
}

export function targetQuestion(operation: TargetedOperation): string {
	return `${operation.toLowerCase()}_target`;
}

function stateFor(request: DecisionRequest, maxRecent: number): Record<string, unknown> {
	const recent = request.history.slice(-maxRecent).map((entry) => ({
		operation: entry.operation,
		...(entry.target === undefined ? {} : { target: entry.target }),
		outcome: entry.outcome,
	}));
	return {
		goal: request.goal,
		app: request.space.app,
		...(request.space.windowTitle === undefined ? {} : { window: request.space.windowTitle }),
		elements: request.space.elements,
		text: request.space.visibleText,
		recent,
	};
}

function answersOf(text: string): Record<string, Answer> {
	const parsed: unknown = JSON.parse(text);
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("decision endpoint returned a non-object body");
	}
	const choices = (parsed as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error("decision endpoint returned no choices");
	}
	const first = choices[0] as { message?: { content?: unknown } };
	const content = first.message?.content;
	if (typeof content !== "string") {
		throw new Error("decision endpoint returned no message content");
	}
	const decoded: unknown = JSON.parse(content);
	if (typeof decoded !== "object" || decoded === null) {
		throw new Error("decision answer was not an object");
	}
	const answers = (decoded as { answers?: unknown }).answers;
	if (typeof answers !== "object" || answers === null) {
		throw new Error("decision answer carried no answers map");
	}
	return answers as Record<string, Answer>;
}

export function validate(answers: Readonly<Record<string, Answer>>, space: ActionSpace): DecisionOutcome {
	const operationAnswer = answers["operation"]?.choice;
	if (typeof operationAnswer !== "string") {
		return refuse("malformed-answer", "no operation was chosen");
	}
	if (!space.operations.includes(operationAnswer as Operation)) {
		return refuse("unknown-operation", `${operationAnswer} was not offered`);
	}
	const operation = operationAnswer as Operation;

	let target: Target | undefined;
	if ((TARGETED_OPERATIONS as readonly string[]).includes(operation)) {
		const targeted = operation as TargetedOperation;
		const offered = space.targets[targeted] ?? {};
		const chosen = answers[targetQuestion(targeted)]?.choice;
		if (typeof chosen !== "string" || chosen === "") {
			return refuse("missing-target", `${operation} needs a target and none was chosen`);
		}
		const resolved = offered[Number(chosen)];
		if (resolved === undefined) {
			return refuse("target-not-offered", `${operation} target ${chosen} was not offered`);
		}
		target = resolved;
	}

	const riskClassAnswer = answers["risk_class"]?.choice;
	const riskClass: RiskClass = (RISK_CLASSES as readonly string[]).includes(String(riskClassAnswer))
		? (riskClassAnswer as RiskClass)
		: "reversible_ui";

	const decision: Decision = {
		operation,
		confidence: probability(answers["operation"]?.confidence, 0),
		blockedProbability: probability(answers["blocked"]?.noul, 0),
		goalSatisfiedProbability: probability(answers["goal_satisfied"]?.noul, 0),
		risk: riskFromScore(answers["risk"]?.score),
		riskClass,
		...(target === undefined ? {} : { target }),
		answers,
	};
	return { ok: true, decision };
}

function riskFromScore(score: unknown): number {
	if (typeof score !== "number" || !Number.isFinite(score)) {
		return 0;
	}
	return Math.min(1, Math.max(0, score / RISK_LEVEL_SPAN));
}

function probability(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function refuse(reason: DecisionRefusal["reason"], detail: string): DecisionOutcome {
	return { ok: false, refusal: { reason, detail } };
}
