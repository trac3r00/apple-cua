import type { AXTreeElement, AppState, AxTreeChanges } from "@apple-cua/core";

export type ToolContent =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "image"; readonly data: string; readonly mimeType: "image/png" | "image/jpeg" };

export type ToolResult = {
	readonly content: ToolContent[];
	/**
	 * True when the request was refused rather than carried out, so a caller that only reads
	 * this flag still learns nothing happened; the payload then names the reason.
	 */
	readonly isError?: boolean;
};

/**
 * Cap per diff bucket in a compact post-action result, paired with the element projection
 * below: a post-action answer must stay far smaller than the tree it replaces, so the worst
 * case (long labels in every entry) stays within a few thousand characters per bucket.
 * Omitted entries are counted so the model knows to re-observe instead of assuming.
 */
const MAX_COMPACT_DIFF_ELEMENTS = 25;

const OMITTED_ELEMENTS_NOTE =
	"elements omitted (diff-only observation): what changed is listed above; pass full_state=true or call get_app_state for the complete tree with element ids";

export type ActionEffect = "confirmed" | "partial" | "observed_change" | "unverifiable" | "suspected_noop" | "refused";
export type ActionRoute = "accessibility" | "synthetic_events" | "unknown";
export type ActionDelivery = "background" | "foreground" | "not_applicable" | "unknown";
export type ActionEvidenceKind = "value_readback" | "ax_change" | "window_change";
export type EscalationTarget = "pixel" | "foreground" | "page" | "session";
export type EscalationReason =
	| "route_unavailable"
	| "delivery_failed"
	| "effect_unconfirmed"
	| "suspected_noop"
	| "permission_required"
	| "no_window_target"
	| "stale_observation";

export interface ActionEvidence {
	readonly kind: ActionEvidenceKind;
}

/** What the action helper actually did, reported by the helper itself rather than assumed. */
export interface ActionDispatch {
	readonly route: ActionRoute;
	readonly delivery: ActionDelivery;
}

export interface ActionEscalation {
	readonly target: EscalationTarget;
	readonly reason: EscalationReason;
}

export interface ActionEnvelope {
	/**
	 * How strongly this driver can account for the action: `confirmed` needs readback
	 * evidence that the requested value holds, `partial` means some of several updates
	 * were read back, `observed_change` means the target window changed after the
	 * action without proving the requested outcome, `suspected_noop` means no change
	 * was observed, `unverifiable` means input was delivered with no evidence either
	 * way, and `refused` means nothing was dispatched.
	 */
	readonly effect: ActionEffect;
	/** Which mechanism actually delivered the input. */
	readonly route: ActionRoute;
	readonly delivery: ActionDelivery;
	readonly evidence: readonly ActionEvidence[];
	escalation?: ActionEscalation;
}

interface CompactControl {
	readonly id: number;
	readonly role: string;
	readonly label: string | null;
	readonly value?: string | null;
	readonly actions?: readonly string[];
}

interface CompactChanges {
	readonly added: readonly CompactControl[];
	readonly removed: readonly CompactControl[];
	readonly changed: readonly {
		readonly id: number;
		readonly before: CompactControl;
		readonly after: CompactControl;
	}[];
}

export interface WindowEvent {
	readonly id: number;
	readonly ownerPid: number;
	readonly ownerName: string;
	readonly title: string;
}

export interface VerificationCheck {
	readonly check: string;
	readonly verified: boolean;
	readonly actual: string;
}

export interface Verification {
	readonly verified: boolean;
	readonly checks: readonly VerificationCheck[];
}

export interface SetFieldStepReport {
	readonly element_index: number;
	readonly requested_value: string;
	readonly input_dispatched: boolean;
	readonly observed_value?: string | null;
	readonly status: "verified" | "unverified" | "skipped";
	readonly reason?: string;
}

export interface SetFieldsReport {
	readonly requested: number;
	readonly inputDispatched: number;
	readonly verified: number;
	readonly outcomeVerified: boolean;
	readonly stoppedEarly: boolean;
	readonly uiChanged?: boolean;
	readonly steps: readonly SetFieldStepReport[];
}

/** How one batch step actually dispatched, plus any detail the dispatcher itself reports. */
export interface StepDispatch extends ActionDispatch {
	readonly detail?: unknown;
}

export interface RunStepReport {
	readonly step: number;
	readonly type: string;
	readonly input_dispatched: boolean;
	readonly status: "dispatched" | "skipped" | "failed";
	readonly reason?: string;
	readonly route?: ActionRoute;
	readonly delivery?: ActionDelivery;
	readonly detail?: unknown;
}

export interface RunStepsReport {
	readonly requested: number;
	readonly completed: number;
	readonly stoppedEarly: boolean;
	readonly uiChanged?: boolean;
	readonly steps: readonly RunStepReport[];
}

export function verificationResult(verification: Verification, state: AppState, observationToken?: string): ToolResult {
	const content: ToolContent[] = [
		{
			type: "text",
			text: JSON.stringify(
				{
					verified: verification.verified,
					checks: verification.checks,
					app: state.app,
					bundleId: state.bundleId,
					pid: state.pid,
					...(observationToken === undefined ? {} : { observation_token: observationToken }),
				},
				null,
				2,
			),
		},
	];
	return { content };
}

export function describeElement(element: AXTreeElement): string {
	return `${element.role} ${JSON.stringify(element.label ?? element.value ?? "")}`;
}

const REFUSAL_ESCALATIONS: Readonly<Record<string, ActionEscalation>> = {
	"window-missing": { target: "session", reason: "no_window_target" },
	"window-changed": { target: "session", reason: "no_window_target" },
	"window-bounds-changed": { target: "session", reason: "no_window_target" },
	"stale-observation-token": { target: "session", reason: "stale_observation" },
	"token-observation-mismatch": { target: "session", reason: "stale_observation" },
	"element-not-observed": { target: "session", reason: "stale_observation" },
	"observation-replaced": { target: "session", reason: "stale_observation" },
	"app-not-frontmost": { target: "foreground", reason: "delivery_failed" },
	"app-not-approved": { target: "session", reason: "permission_required" },
	"url-blocked": { target: "session", reason: "permission_required" },
	"url-unavailable": { target: "session", reason: "route_unavailable" },
};

/**
 * A refusal is a result, not a crash: nothing was dispatched, so the answer must say that
 * plainly and point at the next honest step instead of leaving the caller to parse prose.
 */
export function refusalResult(reason: string, detail?: string): ToolResult {
	const escalation = REFUSAL_ESCALATIONS[reason] ?? { target: "session", reason: "route_unavailable" };
	const message = detail ?? `input was refused: ${reason}`;
	return {
		isError: true,
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						actionDispatched: false,
						effect: "refused" satisfies ActionEffect,
						route: "unknown" satisfies ActionRoute,
						delivery: "not_applicable" satisfies ActionDelivery,
						evidence: [],
						reason,
						escalation,
						paused: true,
						needsExplicitObservation: true,
						message: `${message} Nothing was dispatched; observe the app again before retrying.`,
					},
					null,
					2,
				),
			},
		],
	};
}

export function textResult(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

export function stateResult(state: AppState, observationToken?: string): ToolResult {
	const extra = observationToken === undefined ? {} : { observation_token: observationToken };
	return stateToolResult(state, extra);
}

export function observedActionResult(
	state: AppState,
	contextUnchanged: boolean,
	observationToken?: string,
	windowEvents: readonly WindowEvent[] = [],
	dispatch?: ActionDispatch,
): ToolResult {
	const observationStatus = contextUnchanged ? axObservationStatus(state) : "context-changed";
	const envelope = actionEnvelope({
		dispatch,
		observationStatus,
		windowEvents,
	});
	return stateToolResult(
		state,
		{
			actionDispatched: true,
			observationStatus,
			paused: observationToken === undefined,
			needsExplicitObservation: observationToken === undefined,
			...envelopeFields(envelope),
			...(windowEvents.length === 0 ? {} : { windowEvents }),
			...(observationToken === undefined ? {} : { observation_token: observationToken }),
		},
		{ boundDiff: true },
	);
}

function actionEnvelope(input: {
	readonly dispatch: ActionDispatch | undefined;
	readonly observationStatus: "changed" | "unchanged" | "unavailable" | "context-changed";
	readonly windowEvents: readonly WindowEvent[];
	readonly readbackConfirmed?: boolean;
}): ActionEnvelope {
	const effect: ActionEffect =
		input.readbackConfirmed === true
			? "confirmed"
			: input.observationStatus === "unchanged"
				? "suspected_noop"
				: input.observationStatus === "changed"
					? "observed_change"
					: "unverifiable";
	const evidence: ActionEvidence[] = [];
	if (input.readbackConfirmed === true) {
		evidence.push({ kind: "value_readback" });
	}
	if (effect === "observed_change") {
		evidence.push({ kind: "ax_change" });
	}
	if (input.windowEvents.length > 0) {
		evidence.push({ kind: "window_change" });
	}
	return {
		effect,
		route: input.dispatch?.route ?? "unknown",
		delivery: input.dispatch?.delivery ?? "unknown",
		evidence,
		...escalationFor(effect, input.dispatch),
	};
}

function escalationFor(effect: ActionEffect, dispatch: ActionDispatch | undefined): { escalation?: ActionEscalation } {
	if (effect === "suspected_noop") {
		return {
			escalation:
				dispatch?.route === "accessibility"
					? { target: "pixel", reason: "suspected_noop" }
					: { target: "foreground", reason: "suspected_noop" },
		};
	}
	if (effect === "unverifiable") {
		return { escalation: { target: "page", reason: "effect_unconfirmed" } };
	}
	return {};
}

function envelopeFields(envelope: ActionEnvelope): Record<string, unknown> {
	return {
		effect: envelope.effect,
		route: envelope.route,
		delivery: envelope.delivery,
		evidence: envelope.evidence,
		...(envelope.escalation === undefined ? {} : { escalation: envelope.escalation }),
	};
}

export function observedSetFieldsResult(
	state: AppState,
	report: SetFieldsReport,
	contextUnchanged: boolean,
	observationToken?: string,
): ToolResult {
	const observationStatus = contextUnchanged ? axObservationStatus(state) : "context-changed";
	const effect: ActionEffect =
		report.verified === 0 ? "unverifiable" : report.outcomeVerified ? "confirmed" : "partial";
	const envelope = actionEnvelope({
		dispatch: { route: "accessibility", delivery: "background" },
		observationStatus,
		windowEvents: [],
		readbackConfirmed: report.outcomeVerified,
	});
	return stateToolResult(
		state,
		{
			actionDispatched: true,
			observationStatus,
			paused: observationToken === undefined,
			needsExplicitObservation: observationToken === undefined,
			setFields: report,
			...envelopeFields({ ...envelope, effect }),
			...(observationToken === undefined ? {} : { observation_token: observationToken }),
		},
		{ boundDiff: true },
	);
}

export function observedRunStepsResult(
	state: AppState,
	report: RunStepsReport,
	verification: Verification | undefined,
	contextUnchanged: boolean,
	observationToken?: string,
	windowEvents: readonly WindowEvent[] = [],
): ToolResult {
	const observationStatus = contextUnchanged ? axObservationStatus(state) : "context-changed";
	const effect: ActionEffect =
		verification?.verified === true
			? "confirmed"
			: report.completed > 0 && report.stoppedEarly
				? "partial"
				: report.completed === 0
					? "refused"
					: observationStatus === "unchanged"
						? "suspected_noop"
						: observationStatus === "changed"
							? "observed_change"
							: "unverifiable";
	const routes = new Set<ActionRoute>(
		report.steps.flatMap((step) => (step.input_dispatched && step.route !== undefined ? [step.route] : [])),
	);
	const deliveries = new Set<ActionDelivery>(
		report.steps.flatMap((step) => (step.input_dispatched && step.delivery !== undefined ? [step.delivery] : [])),
	);
	const envelope = actionEnvelope({
		dispatch: {
			route: routes.size === 1 ? ([...routes][0] ?? "unknown") : "unknown",
			delivery: deliveries.size === 1 ? ([...deliveries][0] ?? "unknown") : "unknown",
		},
		observationStatus,
		windowEvents,
		readbackConfirmed: verification?.verified === true,
	});
	return stateToolResult(
		state,
		{
			actionDispatched: report.completed > 0,
			observationStatus,
			paused: observationToken === undefined,
			needsExplicitObservation: observationToken === undefined,
			runSteps: report,
			...(verification === undefined ? {} : { verification }),
			...envelopeFields({ ...envelope, effect }),
			...(windowEvents.length === 0 ? {} : { windowEvents }),
			...(observationToken === undefined ? {} : { observation_token: observationToken }),
		},
		{ boundDiff: true },
	);
}

export function postActionErrorResult(error: unknown, partial?: Record<string, unknown>): ToolResult {
	return textResult(
		JSON.stringify(
			{
				actionDispatched: true,
				observationStatus: "error",
				paused: true,
				needsExplicitObservation: true,
				...(partial === undefined ? {} : partial),
				error: error instanceof Error ? error.message : String(error),
			},
			null,
			2,
		),
	);
}

const TRUNCATED_ELEMENTS_NOTE =
	"elements is capped at the driver's element budget, so controls further down the tree are missing; repeat get_app_state with a higher max_elements, or pass subtree_of with the id of a parent element to walk just that branch";

const TREE_SKIPPED_NOTE =
	"the accessibility tree was skipped for this capture-only observation (include_accessibility_tree=false), so no element ids were produced and no observation_token was issued; call get_app_state with the tree before any element action";

function stateToolResult(
	state: AppState,
	extra: Record<string, unknown>,
	options: { readonly boundDiff?: boolean } = {},
): ToolResult {
	const payload: Record<string, unknown> = { ...state, screenshotBase64: undefined };
	if (state.treeSkipped === true) {
		payload["elements"] = undefined;
		payload["note"] = TREE_SKIPPED_NOTE;
	} else if (state.treeOmitted === true) {
		payload["elements"] = undefined;
		payload["note"] = OMITTED_ELEMENTS_NOTE;
		if (options.boundDiff === true) {
			const bounded = boundAxChanges(state.axChanges);
			if (bounded !== undefined) {
				payload["axChanges"] = bounded.changes;
				if (bounded.omitted !== undefined) {
					payload["axChangesOmitted"] = bounded.omitted;
				}
			}
		}
	} else if (state.elementsTruncated === true) {
		payload["note"] = TRUNCATED_ELEMENTS_NOTE;
	}
	const text: ToolContent = { type: "text", text: JSON.stringify({ ...payload, ...extra }, null, 2) };
	const content: ToolContent[] = state.screenshotBase64.length === 0 ? [text] : [stateImage(state), text];
	return { content };
}

function boundAxChanges(
	changes: AxTreeChanges | undefined,
):
	| { readonly changes: CompactChanges; readonly omitted?: { added: number; removed: number; changed: number } }
	| undefined {
	if (changes === undefined) {
		return undefined;
	}
	const added = changes.added.slice(0, MAX_COMPACT_DIFF_ELEMENTS).map(compactControl);
	const removed = changes.removed.slice(0, MAX_COMPACT_DIFF_ELEMENTS).map((element) => ({
		id: element.id,
		role: element.role,
		label: element.label,
	}));
	const changed = changes.changed.slice(0, MAX_COMPACT_DIFF_ELEMENTS).map((entry) => ({
		id: entry.after.id,
		before: compactControl(entry.before),
		after: compactControl(entry.after),
	}));
	const omitted = {
		added: changes.added.length - added.length,
		removed: changes.removed.length - removed.length,
		changed: changes.changed.length - changed.length,
	};
	const truncated = omitted.added + omitted.removed + omitted.changed > 0;
	return {
		changes: { added, removed, changed },
		...(truncated ? { omitted } : {}),
	};
}

function compactControl(element: AXTreeElement): CompactControl {
	return {
		id: element.id,
		role: element.role,
		label: element.label,
		value: element.value,
		actions: element.actions,
	};
}

function stateImage(state: AppState): ToolContent {
	return {
		type: "image",
		data: state.screenshotBase64,
		mimeType: state.screenshotMimeType ?? "image/png",
	};
}

function axObservationStatus(state: AppState): "changed" | "unchanged" | "unavailable" {
	const summary = state.axChangeSummary;
	if (summary === undefined) {
		return "unavailable";
	}
	return summary.added + summary.removed + summary.changed === 0 ? "unchanged" : "changed";
}
