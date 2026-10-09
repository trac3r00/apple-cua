import type { AXTreeElement, AppState, AxTreeChanges, ElementMatch, SystemPrompt } from "@apple-cua/core";

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

const WINDOW_CONTENT_UNAVAILABLE_NOTE =
	"this session does not own the Mac's physical screen (Screen Sharing or fast user switching), so the app's window content is not reachable over accessibility: ocrText is the window read from pixels, with screen frames. Keyboard input (type_text, press_keys) still reaches the app; pointer clicks and window-level menu items such as Save do not. Use keyboard routes, and call ask_user when a step needs a click or Save.";

const SCREENSHOT_UNAVAILABLE_NOTE =
	"no image: the process running apple-cua lacks macOS Screen Recording permission, so no capture was attempted (it would raise a permission prompt over the person's screen). Elements and ids are complete and actions work. If pixels are needed, ask the user to grant Screen Recording to the app that launches this server and restart it.";

export const SYSTEM_PROMPT_NOTE =
	"a macOS system dialog is on screen (see systemPrompts): it belongs to no app you are driving, only the person at the Mac can answer it, and it can block input or capture until they do. Never click or type into it; call ask_user to hand it over, naming what it asks for.";

export type ActionEffect = "confirmed" | "partial" | "observed_change" | "unverifiable" | "suspected_noop" | "refused";
export type ActionRoute = "accessibility" | "synthetic_events" | "unknown";
export type ActionDelivery = "background" | "foreground" | "not_applicable" | "unknown";
export type ActionEvidenceKind = "value_readback" | "ax_change" | "window_change";
export type EscalationTarget = "pixel" | "foreground" | "page" | "session" | "human";
export type EscalationReason =
	| "route_unavailable"
	| "delivery_failed"
	| "effect_unconfirmed"
	| "suspected_noop"
	| "permission_required"
	| "no_window_target"
	| "stale_observation"
	| "screen_locked"
	| "user_stopped"
	| "needs_user";

export interface ActionEvidence {
	readonly kind: ActionEvidenceKind;
}

/** What the action helper actually did, reported by the helper itself rather than assumed. */
export interface ActionDispatch {
	readonly route: ActionRoute;
	readonly delivery: ActionDelivery;
	/** Set when the first route failed and the action completed through the reported one instead. */
	readonly fallback?: ActionFallback;
}

export interface ActionFallback {
	readonly from: ActionRoute;
	readonly reason: string;
}

export interface ActionEscalation {
	readonly target: EscalationTarget;
	readonly reason: EscalationReason;
}

interface ActionEnvelope {
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
	readonly fallback?: ActionFallback;
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
	/** The refusal reason when the batch was halted by a refusal (`user-stopped`) rather than a step failure. */
	readonly refused?: string;
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
	/** `satisfied` is a wait_for step whose condition held; it dispatches no input. */
	readonly status: "dispatched" | "satisfied" | "skipped" | "failed";
	readonly reason?: string;
	readonly route?: ActionRoute;
	readonly delivery?: ActionDelivery;
	readonly fallback?: ActionFallback;
	/** The element a `target` step resolved to in the fresh read, so the caller can see what was acted on. */
	readonly resolved_element?: { readonly id: number; readonly role: string; readonly label: string | null };
	/** How a step with a `find` field located its target: by which channel, and how far it had to scroll. */
	readonly found?: {
		readonly found_by?: "accessibility" | "vision";
		readonly pages_scrolled: number;
		readonly direction: string;
		/** The target existed but was outside its scroll area, so it was scrolled into view (AXScrollToVisible). */
		readonly scrolled_into_view?: boolean;
		/** not-needed, used, off, or skipped: <why the window could not be read from pixels>. */
		readonly vision: string;
		readonly matched_text?: string;
	};
	readonly detail?: unknown;
}

export interface RunStepsReport {
	readonly requested: number;
	readonly completed: number;
	readonly stoppedEarly: boolean;
	/** The refusal reason when the batch was halted by a refusal (`user-stopped`) rather than a step failure. */
	readonly refused?: string;
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
	"app-not-approved": { target: "human", reason: "needs_user" },
	"url-blocked": { target: "human", reason: "needs_user" },
	"screen-locked": { target: "human", reason: "screen_locked" },
	"user-stopped": { target: "human", reason: "user_stopped" },
	"url-unavailable": { target: "session", reason: "route_unavailable" },
};

/**
 * A refusal is a result, not a crash: nothing was dispatched, so the answer must say that
 * plainly and point at the next honest step instead of leaving the caller to parse prose.
 */
export function lockRefusalResult(error: unknown): ToolResult | undefined {
	return error instanceof Error && error.message.startsWith("Computer Use is paused because the Mac is locked.")
		? refusalResult("screen-locked", error.message)
		: undefined;
}

export function refusalResult(reason: string, detail?: string): ToolResult {
	const escalation = REFUSAL_ESCALATIONS[reason] ?? { target: "session", reason: "route_unavailable" };
	const message = detail ?? `input was refused: ${reason}`;
	const nextStep =
		reason === "screen-locked"
			? "Nothing was dispatched; call ask_user to ask the user to unlock the Mac before observing again."
			: reason === "user-stopped"
				? "Nothing was dispatched. Do not retry; tell the user."
				: escalation.target === "human"
					? "Nothing was dispatched; call ask_user to request human help. Host policy must still authorize the app or URL before retrying."
					: "Nothing was dispatched; observe the app again before retrying.";
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
						message: `${message} ${nextStep}`,
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

export function stateResult(state: AppState, observationToken?: string, elementFormat?: ElementFormat): ToolResult {
	const extra = observationToken === undefined ? {} : { observation_token: observationToken };
	return stateToolResult(state, extra, { elementFormat });
}

/**
 * "table" sends each element as one tab-separated row under element_columns instead of a JSON
 * object: the same facts at roughly a fifth of the size, which is most of an observation's cost.
 */
export type ElementFormat = "json" | "table";

const ELEMENT_TABLE_COLUMNS = "id\trole\tlabel\tvalue\tframe(x,y,w,h)\tactions\tchildren";

function tableCell(value: string | null): string {
	return (value ?? "").replace(/[\t\r\n]+/g, " ");
}

function elementRow(element: AXTreeElement): string {
	const frame = [element.frame.x, element.frame.y, element.frame.width, element.frame.height].map(Math.round);
	return [
		String(element.id),
		element.role.replace(/^AX/, ""),
		tableCell(element.label),
		tableCell(element.value),
		frame.join(","),
		element.actions.map((action) => action.replace(/^AX/, "")).join(","),
		element.children.join(","),
	].join("\t");
}

export function observedActionResult(
	state: AppState,
	contextUnchanged: boolean,
	observationToken?: string,
	windowEvents: readonly WindowEvent[] = [],
	dispatch?: ActionDispatch,
	extra: Record<string, unknown> = {},
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
			...extra,
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
			: input.windowEvents.length > 0
				? "observed_change"
				: input.observationStatus === "unchanged"
					? "suspected_noop"
					: input.observationStatus === "changed"
						? "observed_change"
						: "unverifiable";
	const evidence: ActionEvidence[] = [];
	if (input.readbackConfirmed === true) {
		evidence.push({ kind: "value_readback" });
	}
	if (effect === "observed_change" && input.observationStatus === "changed") {
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
		...(input.dispatch?.fallback === undefined ? {} : { fallback: input.dispatch.fallback }),
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
		...(envelope.fallback === undefined ? {} : { fallback: envelope.fallback }),
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
	// A wait dispatches no input: a run of waits that were all satisfied confirmed what it waited for.
	const waitedOnly = report.steps.length > 0 && report.steps.every((step) => step.status === "satisfied");
	const effect: ActionEffect =
		verification?.verified === true || waitedOnly
			? "confirmed"
			: report.completed > 0 && report.stoppedEarly
				? "partial"
				: report.completed === 0
					? "refused"
					: windowEvents.length > 0
						? "observed_change"
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
	"elements is capped at the driver's element budget, so controls further down the tree are missing; reveal or find the control yourself instead of asking a person to scroll (run_steps reveal or app.reveal, find_elements, a higher max_elements, or subtree_of with a parent element id), then inspect and verify";

const TREE_SKIPPED_NOTE =
	"the accessibility tree was skipped for this capture-only observation (include_accessibility_tree=false), so no element ids were produced and no observation_token was issued; call get_app_state with the tree before any element action";

function stateToolResult(
	state: AppState,
	extra: Record<string, unknown>,
	options: { readonly boundDiff?: boolean; readonly elementFormat?: ElementFormat | undefined } = {},
): ToolResult {
	const payload: Record<string, unknown> = { ...state, screenshotBase64: undefined };
	if (options.elementFormat === "table" && state.treeSkipped !== true && state.treeOmitted !== true) {
		payload["elements"] = undefined;
		payload["element_columns"] = ELEMENT_TABLE_COLUMNS;
		payload["element_rows"] = state.elements.map(elementRow);
	}
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
		} else if (state.axChanges !== undefined) {
			// An observation's diff. An explicit element_format=json asks for everything; otherwise each bucket
			// is capped (counting what was left out) and, for table, written as the same rows a full tree uses.
			const capped = options.elementFormat === "json" ? { changes: state.axChanges } : capAxChanges(state.axChanges);
			if (options.elementFormat === "table") {
				payload["element_columns"] = ELEMENT_TABLE_COLUMNS;
				payload["axChanges"] = {
					added: capped.changes.added.map(elementRow),
					removed: capped.changes.removed.map(elementRow),
					changed: capped.changes.changed.map((entry) => ({
						before: elementRow(entry.before),
						after: elementRow(entry.after),
					})),
				};
			} else {
				payload["axChanges"] = capped.changes;
			}
			if (capped.omitted !== undefined) {
				payload["axChangesOmitted"] = capped.omitted;
			}
		}
	} else if (state.elementsTruncated === true) {
		payload["note"] = TRUNCATED_ELEMENTS_NOTE;
	}
	if (state.windowContentUnavailable === true) {
		payload["windowContentNote"] = WINDOW_CONTENT_UNAVAILABLE_NOTE;
	}
	if (state.screenshotUnavailable !== undefined) {
		payload["screenshotNote"] = SCREENSHOT_UNAVAILABLE_NOTE;
	}
	if (state.systemPrompts !== undefined && state.systemPrompts.length > 0) {
		payload["systemPrompts"] = state.systemPrompts.map(describeSystemPrompt);
		// The instruction rides on observations; an action's answer lists the prompts alone, so a prompt
		// the action raised is still seen without repeating the note on every step.
		if (options.boundDiff !== true) {
			payload["systemPromptNote"] = SYSTEM_PROMPT_NOTE;
		}
	}
	// Unindented: an observation is read by a model, and indentation alone was about 45% of its size.
	const text: ToolContent = { type: "text", text: JSON.stringify({ ...payload, ...extra }) };
	const content: ToolContent[] = state.screenshotBase64.length === 0 ? [text] : [stateImage(state), text];
	return { content };
}

/** Each bucket cut to the compact-diff cap, with the exact count of entries left out when any were. */
function capAxChanges(changes: AxTreeChanges): {
	readonly changes: AxTreeChanges;
	readonly omitted?: { added: number; removed: number; changed: number };
} {
	const capped: AxTreeChanges = {
		added: changes.added.slice(0, MAX_COMPACT_DIFF_ELEMENTS),
		removed: changes.removed.slice(0, MAX_COMPACT_DIFF_ELEMENTS),
		changed: changes.changed.slice(0, MAX_COMPACT_DIFF_ELEMENTS),
	};
	const omitted = {
		added: changes.added.length - capped.added.length,
		removed: changes.removed.length - capped.removed.length,
		changed: changes.changed.length - capped.changed.length,
	};
	return omitted.added + omitted.removed + omitted.changed > 0 ? { changes: capped, omitted } : { changes: capped };
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

/** A control as a targeting answer names it: an id the caller can act on, and what it is. */
export interface CompactElement {
	readonly element_index: string;
	readonly role: string;
	readonly label: string | null;
	readonly value: string | null;
	readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly actions: readonly string[];
}

export interface CompactElementMatch extends CompactElement {
	/** Which constraints this element satisfied, and the traits that lifted its rank. */
	readonly matched_by: readonly string[];
	readonly score: number;
}

export function compactElement(element: AXTreeElement): CompactElement {
	return {
		element_index: String(element.id),
		role: element.role,
		label: element.label,
		value: element.value,
		frame: element.frame,
		actions: element.actions,
	};
}

export function compactElementMatch(match: ElementMatch): CompactElementMatch {
	return { ...compactElement(match.element), matched_by: match.matchedBy, score: match.score };
}

/**
 * The answer to a described-element call: the observation context, the targeting payload, and the
 * one-use token, with pixels only when the caller asked for them and the tree only when it asked
 * for the whole state. A targeting answer stays about a kilobyte.
 */
export function targetStateResult(
	state: AppState,
	extra: Record<string, unknown>,
	options: {
		readonly token?: string | undefined;
		readonly includeScreenshot?: boolean | undefined;
		readonly includeElements?: boolean | undefined;
	} = {},
): ToolResult {
	const payload: Record<string, unknown> = {
		...observationContext(state),
		...extra,
		...(options.token === undefined ? {} : { observation_token: options.token }),
		...(options.includeElements === true ? { elements: state.elements } : {}),
	};
	const content: ToolContent[] = [];
	if (options.includeScreenshot === true && state.screenshotBase64.length > 0) {
		content.push(stateImage(state));
	}
	content.push({ type: "text", text: JSON.stringify(payload, null, 2) });
	return { content };
}

/**
 * A targeting call against an app that is not running: nothing was observed and nothing was
 * dispatched, and the answer names the verb that would have made it possible.
 */
export function appNotRunningResult(app: string, detail: string): ToolResult {
	return {
		isError: true,
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						found: false,
						actionDispatched: false,
						effect: "refused" satisfies ActionEffect,
						reason: "app-not-running",
						app,
						message: `${detail} Nothing was dispatched. Call open_app to launch or activate it, then retry.`,
					},
					null,
					2,
				),
			},
		],
	};
}

/**
 * The answer to open_app: either the app is now running and named, or the launch failed and the
 * answer says what was attempted. Opening an app authorizes no observation and no input.
 */
export function openAppResult(payload: Record<string, unknown>, error: string | undefined): ToolResult {
	const content: ToolContent[] = [
		{
			type: "text",
			text: JSON.stringify(
				{
					...payload,
					needsExplicitObservation: true,
					...(error === undefined ? {} : { error, paused: true }),
				},
				null,
				2,
			),
		},
	];
	return error === undefined ? { content } : { isError: true, content };
}

function observationContext(state: AppState): Record<string, unknown> {
	return {
		app: state.app,
		bundleId: state.bundleId,
		pid: state.pid,
		frontmost: state.frontmost,
		axAvailable: state.axAvailable,
		...(state.windowId === undefined ? {} : { windowId: state.windowId }),
		...(state.windowTitle === undefined ? {} : { windowTitle: state.windowTitle }),
		...(state.windowBounds === undefined ? {} : { windowBounds: state.windowBounds }),
		...(state.contentKind === undefined ? {} : { contentKind: state.contentKind }),
	};
}

/** The compact form a model needs: whose dialog, what it is about, and what kind of answer it wants. */
export function describeSystemPrompt(prompt: SystemPrompt): {
	owner: string;
	title: string;
	kind: string;
	window_id: number;
} {
	return { owner: prompt.owner, title: prompt.title, kind: prompt.kind, window_id: prompt.windowId };
}
