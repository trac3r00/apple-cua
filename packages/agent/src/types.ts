/**
 * The vocabulary the decision layer speaks. Every type is deliberately closed: an answer naming an
 * operation or target the table did not offer is refused, never interpreted.
 */

/** What the agent is allowed to choose. The offered set is built per observation, never fixed. */
export type Operation =
	| "PRESS"
	| "TYPE_TEXT"
	| "SCROLL_UP"
	| "SCROLL_DOWN"
	| "PRESS_RETURN"
	| "PRESS_ESCAPE"
	| "WAIT"
	| "DONE"
	| "BLOCKED";

export const TARGETED_OPERATIONS = ["PRESS", "TYPE_TEXT"] as const satisfies readonly Operation[];

export type TargetedOperation = (typeof TARGETED_OPERATIONS)[number];

/**
 * How consequential the chosen operation is. A closed set rather than a sentence because the
 * decision model returns typed answers only, so a free-text risk reason is not available to it.
 */
export type RiskClass =
	| "reversible_ui"
	| "changes_document"
	| "changes_setting"
	| "sends_or_publishes"
	| "deletes_or_overwrites"
	| "grants_or_signs_in"
	| "installs_or_pays";

export const RISK_CLASSES = [
	"reversible_ui",
	"changes_document",
	"changes_setting",
	"sends_or_publishes",
	"deletes_or_overwrites",
	"grants_or_signs_in",
	"installs_or_pays",
] as const satisfies readonly RiskClass[];

/** One row of the table the decision model reads. */
export interface TableElement {
	/** The driver's element id. A decision names this, never an array position. */
	readonly index: number;
	/** Accessibility role with its `AX` prefix removed, so the table reads as plain words. */
	readonly role: string;
	readonly label?: string;
	readonly value?: string;
	readonly operations: readonly TargetedOperation[];
}

/**
 * One selectable target. It carries the identity that must still hold when the operation runs:
 * element ids are only valid for the observation that produced them, and a tree can move between
 * deciding and acting, so the executor refuses unless the element still mentions what was chosen.
 */
export interface Target {
	readonly operation: TargetedOperation;
	readonly index: number;
	readonly label: string;
	readonly role: string;
	readonly expectLabel: string;
	readonly expectRole: string;
}

export interface ActionSpace {
	readonly platform: "macos" | "ios";
	readonly app: string;
	readonly windowTitle?: string;
	readonly elements: readonly TableElement[];
	/** Visible static text, offered as context rather than as a choice. */
	readonly visibleText: readonly string[];
	readonly targets: Readonly<Partial<Record<TargetedOperation, Readonly<Record<number, Target>>>>>;
	readonly operations: readonly Operation[];
	readonly truncated: boolean;
	readonly pruned: number;
	/**
	 * True when the screen exposed almost nothing to choose from. A sparse table is not a licence
	 * to guess: callers with a pixel fallback may use it, and callers without one should stop.
	 */
	readonly sparse: boolean;
}

/** The answer to one fan-out request, after every field has been checked against the table. */
export interface Decision {
	readonly operation: Operation;
	/** The model's calibrated probability for the chosen operation, not a self-reported guess. */
	readonly confidence: number;
	readonly blockedProbability: number;
	readonly goalSatisfiedProbability: number;
	readonly risk: number;
	readonly riskClass: RiskClass;
	readonly target?: Target;
	readonly text?: string;
	readonly answers: Readonly<Record<string, unknown>>;
}

/** A refusal is not an error: nothing ran, and the caller decides what happens next. */
export type DecisionRefusal =
	| { readonly reason: "unknown-operation"; readonly detail: string }
	| { readonly reason: "missing-target"; readonly detail: string }
	| { readonly reason: "target-not-offered"; readonly detail: string }
	| { readonly reason: "malformed-answer"; readonly detail: string };

export type DecisionOutcome =
	| { readonly ok: true; readonly decision: Decision }
	| { readonly ok: false; readonly refusal: DecisionRefusal };
