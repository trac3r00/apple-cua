import { randomUUID } from "node:crypto";
import { parseElementIndex, resolveAppPid } from "@macos-cua/core";
import type {
	AXTreeElement,
	AppState,
	GuardedComputerInterface,
	InputObservation,
	Point,
	Rect,
	TopLevelWindow,
} from "@macos-cua/core";
import {
	type ActionDispatch,
	type SetFieldStepReport,
	type SetFieldsReport,
	type ToolResult,
	type Verification,
	type VerificationCheck,
	type WindowEvent,
	describeElement,
	observedActionResult,
	observedSetFieldsResult,
	postActionErrorResult,
	refusalResult,
	stateResult,
	textResult,
	verificationResult,
} from "./tool-result.js";

const VERIFY_POLL_INTERVAL_MILLISECONDS = 150;

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

const STRICT_STATE_OPTIONS = { requireWindow: true } as const;
const STRICT_DIFF_STATE_OPTIONS = { diffOnly: true, requireWindow: true } as const;
const FIELD_VERIFY_STATE_OPTIONS = { requireWindow: true, settleMs: 80 } as const;

export interface MutationOptions {
	/** Return the whole accessibility tree in the post-action observation instead of only the diff. */
	readonly fullState?: boolean;
}

export interface ObservationOptions {
	/** Omit the image: the cheapest way to re-index elements before an element action. */
	readonly includeScreenshot?: boolean;
	/** Cap the accessibility elements returned for this observation. */
	readonly maxElements?: number;
	/** Include the application menu bar, which is app chrome rather than window content. */
	readonly includeMenuBar?: boolean;
	/**
	 * Observe only the subtree rooted at this element id from the previous observation of the
	 * same app. Ids restart at 0 inside the subtree, which is how a capped or truncated tree is
	 * explored a branch at a time instead of raising max_elements.
	 */
	readonly subtreeOf?: number;
}

export interface ObserveRequest extends ObservationOptions {
	readonly app: string;
	readonly diffOnly: boolean;
}

export interface VerifyCheckRequest {
	readonly element_index: string;
	readonly exists?: boolean | undefined;
	readonly value?: string | undefined;
	readonly label?: string | undefined;
}

export interface VerifyRequest {
	readonly checks?: readonly VerifyCheckRequest[] | undefined;
	readonly windowTitle?: string | undefined;
	readonly timeoutMs?: number | undefined;
}

export interface SetFieldUpdate {
	readonly element_index: string;
	readonly value: string;
}

// biome-ignore lint/suspicious/noConfusingVoidType: a mutation may report how it dispatched input, or report nothing when its route is not known to it
type Mutation = (targetPid: number, observation: InputObservation) => Promise<ActionDispatch | void>;
type Validation = (observation: InputObservation) => void;
type ObservedElementIdentity = ReadonlyMap<
	number,
	{ readonly role: string; readonly label: string | null; readonly y: number }
>;

/** A refusal to dispatch input: nothing was sent, and the caller must be told why. */
class InputRefusal extends Error {
	constructor(
		readonly reason: string,
		detail?: string,
	) {
		super(detail ?? `input refused: ${reason}`);
	}
}

interface LiveToken {
	readonly token: string;
	readonly observation: InputObservation;
	readonly elements: ObservedElementIdentity | undefined;
}

export class GuardedSession {
	private readonly tokens = new Map<string, LiveToken>();
	private readonly tokenByPid = new Map<number, string>();
	private readonly tails = new Map<number, Promise<void>>();
	private globalTail: Promise<void> = Promise.resolve();
	private closed = false;
	private closePromise: Promise<void> | undefined;

	constructor(
		private readonly computer: GuardedComputerInterface,
		private readonly windowProbe?: () => Promise<readonly TopLevelWindow[]>,
	) {}

	listApps(): Promise<ToolResult> {
		return this.enqueue(undefined, async () => textResult(JSON.stringify(await this.computer.listApps(), null, 2)));
	}

	async observe(request: ObserveRequest): Promise<ToolResult> {
		const targetPid = await resolveAppPid(this.computer, request.app);
		return this.enqueue(targetPid, async () => {
			this.clearTokenFor(targetPid);
			const state = await this.computer.getAppState(targetPid, {
				...(request.diffOnly ? STRICT_DIFF_STATE_OPTIONS : STRICT_STATE_OPTIONS),
				...(request.includeScreenshot === undefined ? {} : { includeScreenshot: request.includeScreenshot }),
				...(request.maxElements === undefined ? {} : { maxElements: request.maxElements }),
				...(request.includeMenuBar === undefined ? {} : { includeMenuBar: request.includeMenuBar }),
				...(request.subtreeOf === undefined ? {} : { subtreeOf: request.subtreeOf }),
			});
			this.assertOpen();
			const observation = this.computer.getInputObservation(targetPid);
			const token =
				observation !== undefined && observationMatchesState(observation, state)
					? this.issue(observation, observedElementIdentity(state))
					: undefined;
			return stateResult(state, token);
		});
	}

	mutate(
		token: string,
		app: string,
		validate: Validation,
		action: Mutation,
		options: MutationOptions = {},
	): Promise<ToolResult> {
		return this.enqueue(this.laneForRequestedToken(token), async () => {
			let expected: Awaited<ReturnType<typeof this.beginMutation>>;
			try {
				expected = await this.beginMutation(token, app, validate);
			} catch (error: unknown) {
				const refused = this.refusalFrom(error);
				if (refused !== undefined) {
					return refused;
				}
				throw error;
			}
			const beforeAction = await this.captureWindowBaseline();
			const dispatch = await action(expected.pid, expected.observation);
			try {
				const outcome = await this.readOutcome(expected.pid, expected.observation, options);
				const windowEvents = await this.describeWindowSideEffects(beforeAction);
				return observedActionResult(
					outcome.state,
					outcome.contextUnchanged,
					outcome.nextToken,
					windowEvents,
					dispatch === undefined ? undefined : dispatch,
				);
			} catch (error: unknown) {
				this.clearTokenFor(expected.pid);
				return postActionErrorResult(error);
			}
		});
	}

	setFields(
		token: string,
		app: string,
		updates: readonly SetFieldUpdate[],
		options: MutationOptions = {},
	): Promise<ToolResult> {
		return this.enqueue(this.laneForRequestedToken(token), async () => {
			let expected: Awaited<ReturnType<typeof this.beginMutation>>;
			try {
				expected = await this.beginMutation(token, app, () => undefined);
			} catch (error: unknown) {
				const refused = this.refusalFrom(error);
				if (refused !== undefined) {
					return refused;
				}
				throw error;
			}
			const targets = updates.map((update) => ({ update, index: parseFieldIndex(update.element_index) }));
			for (const target of targets) {
				validateElement(expected.observation, target.index);
			}

			const steps: SetFieldStepReport[] = [];
			let baseline = await this.readFieldBaseline(expected.pid);
			let uiChanged = false;
			let stoppedEarly = false;

			for (const { update, index } of targets) {
				const element = baseline.elements.get(index);
				if (element === undefined) {
					steps.push(skippedStep(index, update.value, "element index is not present in the latest observation"));
					stoppedEarly = true;
					break;
				}
				const observedIdentity = expected.elements?.get(index);
				if (observedIdentity !== undefined && !sameElementIdentity(observedIdentity, element)) {
					steps.push(
						skippedStep(
							index,
							update.value,
							`element ${index} is now ${element.role} "${element.label ?? ""}", not the observed control; re-observe`,
						),
					);
					stoppedEarly = true;
					break;
				}

				try {
					await this.computer.setValue(expected.pid, index, update.value);
				} catch (error: unknown) {
					steps.push({
						element_index: index,
						requested_value: update.value,
						input_dispatched: false,
						status: "unverified",
						reason: error instanceof Error ? error.message : String(error),
					});
					stoppedEarly = true;
					break;
				}

				baseline = await this.readFieldBaseline(expected.pid);
				uiChanged = uiChanged || baseline.changed;
				const observedValue = baseline.elements.get(index)?.value ?? null;
				const verified = observedValue === update.value;
				steps.push({
					element_index: index,
					requested_value: update.value,
					input_dispatched: true,
					observed_value: observedValue,
					status: verified ? "verified" : "unverified",
					...(verified ? {} : { reason: "value read back from the app does not match the requested value" }),
				});
				if (!verified) {
					stoppedEarly = true;
					break;
				}
			}

			const report = summarize(steps, updates.length, stoppedEarly, uiChanged);
			try {
				const outcome = await this.readOutcome(expected.pid, expected.observation, options);
				return observedSetFieldsResult(outcome.state, report, outcome.contextUnchanged, outcome.nextToken);
			} catch (error: unknown) {
				this.clearTokenFor(expected.pid);
				return postActionErrorResult(error, report);
			}
		});
	}

	invalidate(): void {
		this.closed = true;
		this.tokens.clear();
		this.tokenByPid.clear();
	}

	async close(): Promise<void> {
		this.invalidate();
		this.closePromise ??= Promise.all([this.globalTail, ...this.tails.values()]).then(async () =>
			this.computer.close(),
		);
		await this.closePromise;
	}

	verify(token: string, app: string, request: VerifyRequest): Promise<ToolResult> {
		return this.enqueue(this.laneForRequestedToken(token), async () => {
			const active = this.consume(token);
			const targetPid = await resolveAppPid(this.computer, app);
			if (targetPid !== active.observation.pid) {
				throw new Error("requested app does not match the token observation");
			}
			const deadline = Date.now() + (request.timeoutMs ?? 0);
			for (;;) {
				this.assertOpen();
				const state = await this.computer.getAppState(targetPid, {
					...STRICT_STATE_OPTIONS,
					includeScreenshot: false,
					settleMs: 0,
				});
				this.assertOpen();
				const verification = await this.runChecks(targetPid, state, request);
				if (verification.verified || Date.now() >= deadline) {
					const observation = this.computer.getInputObservation(targetPid);
					const nextToken =
						observation !== undefined && observationMatchesState(observation, state)
							? this.issue(observation, observedElementIdentity(state))
							: undefined;
					return verificationResult(verification, state, nextToken);
				}
				await delayMilliseconds(VERIFY_POLL_INTERVAL_MILLISECONDS);
			}
		});
	}

	private async runChecks(pid: number, state: AppState, request: VerifyRequest): Promise<Verification> {
		const byId = new Map(state.elements.map((element) => [element.id, element] as const));
		const checks: VerificationCheck[] = [];
		for (const check of request.checks ?? []) {
			const index = parseElementIndex(check.element_index);
			const element = byId.get(index);
			if (check.exists === false) {
				checks.push({
					check: `element ${index} is absent`,
					verified: element === undefined,
					actual: element === undefined ? "absent" : describeElement(element),
				});
				continue;
			}
			if (element === undefined) {
				checks.push({ check: `element ${index} exists`, verified: false, actual: "absent" });
				continue;
			}
			if (check.value !== undefined) {
				checks.push({
					check: `element ${index} value is ${JSON.stringify(check.value)}`,
					verified: (element.value ?? "") === check.value,
					actual: `value ${JSON.stringify(element.value ?? "")}`,
				});
			}
			if (check.label !== undefined) {
				checks.push({
					check: `element ${index} label is ${JSON.stringify(check.label)}`,
					verified: (element.label ?? "") === check.label,
					actual: `label ${JSON.stringify(element.label ?? "")}`,
				});
			}
			if (check.value === undefined && check.label === undefined) {
				checks.push({ check: `element ${index} exists`, verified: true, actual: describeElement(element) });
			}
		}
		if (request.windowTitle !== undefined) {
			const titles = (await this.windowsForPid(pid)).map((window) => window.title);
			checks.push({
				check: `a window titled ${JSON.stringify(request.windowTitle)} is open`,
				verified: titles.includes(request.windowTitle),
				actual: titles.length === 0 ? "window titles are unavailable" : titles.join(" | "),
			});
		}
		return { verified: checks.every((check) => check.verified), checks };
	}

	private async windowsForPid(pid: number): Promise<readonly TopLevelWindow[]> {
		if (this.windowProbe === undefined) {
			return [];
		}
		try {
			return (await this.windowProbe()).filter((window) => window.ownerPid === pid);
		} catch {
			return [];
		}
	}

	private async beginMutation(
		token: string,
		app: string,
		validate: Validation,
	): Promise<{
		readonly pid: number;
		readonly observation: InputObservation;
		readonly elements: ObservedElementIdentity | undefined;
	}> {
		let active: ReturnType<GuardedSession["consume"]>;
		try {
			active = this.consume(token);
		} catch (error: unknown) {
			throw new InputRefusal("stale-observation-token", error instanceof Error ? error.message : undefined);
		}
		const targetPid = await resolveAppPid(this.computer, app);
		if (targetPid !== active.observation.pid) {
			throw new InputRefusal("token-observation-mismatch", "requested app does not match the token observation");
		}
		try {
			validate(active.observation);
		} catch (error: unknown) {
			throw new InputRefusal("element-not-observed", error instanceof Error ? error.message : undefined);
		}
		const preflight = await this.computer.preflightInput(active.observation);
		if (!preflight.ok) {
			throw new InputRefusal(preflight.reason);
		}
		this.assertOpen();
		return { pid: targetPid, observation: active.observation, elements: active.elements };
	}

	private refusalFrom(error: unknown): ToolResult | undefined {
		return error instanceof InputRefusal ? refusalResult(error.reason, error.message) : undefined;
	}

	private async readOutcome(
		targetPid: number,
		expected: InputObservation,
		options: MutationOptions,
	): Promise<{
		readonly state: AppState;
		readonly contextUnchanged: boolean;
		readonly nextToken: string | undefined;
	}> {
		this.assertOpen();
		const state = await this.computer.getAppState(
			targetPid,
			options.fullState === true ? STRICT_STATE_OPTIONS : STRICT_DIFF_STATE_OPTIONS,
		);
		this.assertOpen();
		const current = this.computer.getInputObservation(targetPid);
		const contextUnchanged =
			current !== undefined &&
			state.frontmost &&
			observationMatchesState(current, state) &&
			sameInputContext(expected, current);
		const nextToken = contextUnchanged && hasAxChange(state) ? this.issue(current, undefined) : undefined;
		return { state, contextUnchanged, nextToken };
	}

	private async readFieldBaseline(targetPid: number): Promise<{
		readonly elements: ReadonlyMap<number, AXTreeElement>;
		readonly changed: boolean;
	}> {
		this.assertOpen();
		const state = await this.computer.getAppState(targetPid, FIELD_VERIFY_STATE_OPTIONS);
		this.assertOpen();
		return {
			elements: new Map(state.elements.map((element) => [element.id, element] as const)),
			changed: hasAxChange(state),
		};
	}

	private async captureWindowBaseline(): Promise<readonly number[] | undefined> {
		if (this.windowProbe === undefined) {
			return undefined;
		}
		try {
			return (await this.windowProbe()).map((window) => window.id);
		} catch {
			return undefined;
		}
	}

	private async describeWindowSideEffects(baseline: readonly number[] | undefined): Promise<readonly WindowEvent[]> {
		if (baseline === undefined || this.windowProbe === undefined) {
			return [];
		}
		try {
			const known = new Set(baseline);
			return (await this.windowProbe())
				.filter((window) => !known.has(window.id))
				.map((window) => ({
					id: window.id,
					ownerPid: window.ownerPid,
					ownerName: window.ownerName,
					title: window.title,
				}));
		} catch {
			return [];
		}
	}

	private issue(observation: InputObservation, elements: ObservedElementIdentity | undefined): string {
		const token = randomUUID();
		const previous = this.tokenByPid.get(observation.pid);
		if (previous !== undefined) {
			this.tokens.delete(previous);
		}
		this.tokens.set(token, { token, observation, elements });
		this.tokenByPid.set(observation.pid, token);
		return token;
	}

	/** One live token per app: a new observation of that app invalidates its previous token only. */
	private clearTokenFor(pid: number): void {
		const token = this.tokenByPid.get(pid);
		if (token !== undefined) {
			this.tokens.delete(token);
			this.tokenByPid.delete(pid);
		}
	}

	private laneForRequestedToken(token: string): number | undefined {
		return this.tokens.get(token)?.observation.pid;
	}

	private consume(token: string): LiveToken {
		const live = this.tokens.get(token);
		if (live === undefined) {
			throw new Error("observation token is missing, stale, or already consumed");
		}
		this.tokens.delete(token);
		if (this.tokenByPid.get(live.observation.pid) === token) {
			this.tokenByPid.delete(live.observation.pid);
		}
		return live;
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error("MCP computer session is closed");
		}
	}

	private enqueue<T>(lane: number | undefined, operation: () => Promise<T>): Promise<T> {
		const previous = lane === undefined ? this.globalTail : (this.tails.get(lane) ?? Promise.resolve());
		const result = previous.then(async () => {
			this.assertOpen();
			return await operation();
		});
		const settled = result.then(
			() => undefined,
			() => undefined,
		);
		if (lane === undefined) {
			this.globalTail = settled;
		} else {
			this.tails.set(lane, settled);
		}
		return result;
	}
}

export function validateElement(observation: InputObservation, elementIndex: number): void {
	if (!observation.observedElementIds.has(elementIndex)) {
		throw new Error(`element index ${elementIndex} was not present in the token observation`);
	}
}

export function validatePoint(observation: InputObservation, point: Point): void {
	const { width, height } = observation.screenshotViewport;
	if (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < 0 ||
		point.y < 0 ||
		point.x >= width ||
		point.y >= height
	) {
		throw new Error(`coordinates must be within the observed viewport [0, ${width}) x [0, ${height})`);
	}
}

export function observedPointToScreen(observation: InputObservation, point: Point): Point {
	validatePoint(observation, point);
	const viewport = observation.screenshotViewport;
	return {
		x: viewport.bounds.x + (point.x / viewport.width) * viewport.bounds.width,
		y: viewport.bounds.y + (point.y / viewport.height) * viewport.bounds.height,
	};
}

function parseFieldIndex(elementIndex: string): number {
	const index = Number(elementIndex.trim());
	if (!Number.isSafeInteger(index) || index < 0) {
		throw new Error(`Invalid element index: ${elementIndex}`);
	}
	return index;
}

function observedElementIdentity(state: AppState): ObservedElementIdentity | undefined {
	if (state.treeOmitted === true) {
		return undefined;
	}
	return new Map(
		state.elements.map(
			(element) =>
				[element.id, { role: element.role, label: element.label, y: Math.round(element.frame.y) }] as const,
		),
	);
}

function sameElementIdentity(
	observed: { readonly role: string; readonly label: string | null; readonly y: number },
	element: AXTreeElement,
): boolean {
	return (
		observed.role === element.role && observed.label === element.label && observed.y === Math.round(element.frame.y)
	);
}

function skippedStep(elementIndex: number, requestedValue: string, reason: string): SetFieldStepReport {
	return {
		element_index: elementIndex,
		requested_value: requestedValue,
		input_dispatched: false,
		status: "skipped",
		reason,
	};
}

function summarize(
	steps: readonly SetFieldStepReport[],
	requested: number,
	stoppedEarly: boolean,
	uiChanged: boolean,
): SetFieldsReport {
	const inputDispatched = steps.filter((step) => step.input_dispatched).length;
	const verified = steps.filter((step) => step.status === "verified").length;
	return {
		requested,
		inputDispatched,
		verified,
		outcomeVerified: verified === requested && !stoppedEarly,
		stoppedEarly,
		uiChanged,
		steps,
	};
}

function observationMatchesState(observation: InputObservation, state: AppState): boolean {
	return (
		observation.pid === state.pid &&
		observation.bundleId === state.bundleId &&
		state.windowBounds !== undefined &&
		rectsEqual(observation.windowBounds, state.windowBounds) &&
		observation.screenshotViewport.width === state.screenshotWidth &&
		observation.screenshotViewport.height === state.screenshotHeight
	);
}

function sameInputContext(before: InputObservation, after: InputObservation): boolean {
	return (
		before.pid === after.pid &&
		before.bundleId === after.bundleId &&
		before.windowId === after.windowId &&
		rectsEqual(before.windowBounds, after.windowBounds) &&
		rectsEqual(before.screenshotViewport.bounds, after.screenshotViewport.bounds) &&
		before.screenshotViewport.width === after.screenshotViewport.width &&
		before.screenshotViewport.height === after.screenshotViewport.height
	);
}

function rectsEqual(left: Rect, right: Rect): boolean {
	return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function hasAxChange(state: AppState): boolean {
	const summary = state.axChangeSummary;
	return summary !== undefined && summary.added + summary.removed + summary.changed > 0;
}
