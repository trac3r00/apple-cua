import { randomUUID } from "node:crypto";
import {
	AX_PRESS_ACTION,
	describeQuery,
	describeUserStop,
	matchElements,
	openApplication,
	parseElementIndex,
	resolveAppPid,
	suggestNearMisses,
} from "@apple-cua/core";
import type {
	AXTreeElement,
	AppOpenLauncher,
	AppState,
	ElementMatch,
	ElementQuery,
	GuardedComputerInterface,
	InputObservation,
	Point,
	Rect,
	StopStatusSource,
	SystemPrompt,
	TopLevelWindow,
} from "@apple-cua/core";
import type { ResolvedTargetClick } from "./mutation-actions.js";
import {
	type FindEvidence,
	type ScrollFindChain,
	type ScrollFindResult,
	type StepFind,
	findByScrolling,
} from "./scroll-find.js";
import {
	type ActionDispatch,
	type ElementFormat,
	type RunStepReport,
	type RunStepsReport,
	SYSTEM_PROMPT_NOTE,
	type SetFieldStepReport,
	type SetFieldsReport,
	type StepDispatch,
	type ToolResult,
	type Verification,
	type VerificationCheck,
	type WindowEvent,
	appNotRunningResult,
	compactElement,
	compactElementMatch,
	describeElement,
	describeSystemPrompt,
	lockRefusalResult,
	observedActionResult,
	observedRunStepsResult,
	observedSetFieldsResult,
	openAppResult,
	postActionErrorResult,
	refusalResult,
	stateResult,
	targetStateResult,
	textResult,
	verificationResult,
} from "./tool-result.js";
import type { RunStep } from "./tool-schemas.js";

const VERIFY_POLL_INTERVAL_MILLISECONDS = 150;
/** How long one targeting attempt waits before re-observing while it looks for its element. */
const TARGET_POLL_INTERVAL_MILLISECONDS = 200;
const DEFAULT_FIND_RESULTS = 5;
const MAX_NEAR_MISSES = 5;
const MAX_ALTERNATIVES = 3;

const TIMING_ENABLED = process.env["APPLE_CUA_TIMING"] === "1";

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
	if (!TIMING_ENABLED) {
		return await run();
	}
	const startedAt = performance.now();
	try {
		return await run();
	} finally {
		process.stderr.write(`[timing] ${label} ${(performance.now() - startedAt).toFixed(1)}\n`);
	}
}

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

const STRICT_STATE_OPTIONS = { requireWindow: true } as const;
const STRICT_DIFF_STATE_OPTIONS = { diffOnly: true, requireWindow: true } as const;
// A baseline read only needs element facts; capturing the window image here cost a screen grab
// per element step for pixels nothing looked at.
const FIELD_VERIFY_STATE_OPTIONS = { requireWindow: true, settleMs: 80, includeScreenshot: false } as const;

export interface MutationOptions {
	/** Return the whole accessibility tree in the post-action observation instead of only the diff. */
	readonly fullState?: boolean;
	/**
	 * Attach the post-action window image. The default answer is text-only so a verified step costs
	 * about a kilobyte instead of a hundred, and callers ask for pixels only when pixels decide the
	 * next step.
	 */
	readonly includeScreenshot?: boolean;
	/**
	 * The action maps observed screenshot coordinates onto the screen, so the window must not have
	 * moved or resized since the observation. Element, keyboard and menu actions leave this unset.
	 */
	readonly screenPoints?: boolean;
	/**
	 * Read the whole tree after the action and keep it, so the next action on this app (a script's next
	 * step) can resolve its target against it instead of walking the UI again. The answer is still the
	 * diff-only state a plain read would have produced.
	 */
	readonly retainTree?: boolean;
}

export interface ObservationOptions {
	/** Omit the image: the cheapest way to re-index elements before an element action. */
	readonly includeScreenshot?: boolean;
	/**
	 * Skip the accessibility walk and the settle wait, and answer with the capture only: the
	 * cheapest observation, for previews and for callers that already hold the tree. No element
	 * ids are produced, so no observation token is issued for it.
	 */
	readonly includeAccessibilityTree?: boolean;
	/** Cap the settle wait before capture; 0 skips the wait for a UI the caller knows is still. */
	readonly settleMs?: number;
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
	/**
	 * Observe this WindowServer window id instead of the app's focused window. Use a candidate
	 * from `windowCandidates` when an app has several windows.
	 */
	readonly windowId?: number;
	readonly elementFormat?: ElementFormat;
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

/** Dispatches one click on a control the session resolved by description. */
export type ResolvedTargetDispatcher = (
	targetPid: number,
	observation: InputObservation,
	target: ResolvedTargetClick,
) => Promise<ActionDispatch>;

export interface FindElementsRequest {
	readonly app: string;
	readonly query: ElementQuery;
	readonly windowId?: number;
	readonly maxResults?: number;
	readonly maxElements?: number;
	readonly includeScreenshot?: boolean;
}

export interface ClickTargetRequest {
	readonly app: string;
	readonly query: ElementQuery;
	readonly index?: number;
	/** How long to keep looking for the element before giving up; 0 acts on what is there now. */
	readonly timeoutMs?: number;
	readonly press?: "auto" | "accessibility" | "pointer";
	readonly hoverFirst?: boolean;
	readonly clickCount?: number;
	readonly mouseButton?: "left" | "right" | "middle";
	readonly expect?: VerifyRequest;
	readonly fullState?: boolean;
	readonly includeScreenshot?: boolean;
	readonly windowId?: number;
}

export interface OpenAppRequest {
	readonly name: string;
	readonly timeoutMs?: number;
}

/**
 * Step-type knowledge the session needs to run a batch: which observed element a step
 * targets (if any), how to validate it against the token observation, and how to dispatch it.
 */
export interface StepTarget {
	readonly query: ElementQuery;
	/** Which match to use, best first. */
	readonly index: number;
	/** Look past the edge of the window for it: scroll the area a page at a time, and read the pixels too. */
	readonly find?: StepFind;
}

export interface StepWait {
	readonly query?: ElementQuery;
	/** Wait for the query to stop matching instead of to start matching. */
	readonly gone: boolean;
	readonly windowTitle?: string;
	readonly timeoutMs: number;
}

/** Lets the caller watch a batch progress and stop it between steps. */
export type RunPace = "verified" | "fast";

export interface RunControl {
	/**
	 * `verified` (default) reads the UI before every step that names an element. `fast` resolves the targets
	 * known up front against one read and runs only cheap guards between steps, for a person-like chain.
	 */
	readonly pace?: RunPace;
	readonly signal?: AbortSignal;
	readonly onProgress?: (completed: number, total: number, message: string) => void;
}

export interface RunStepDriver {
	readonly elementIndex: (step: RunStep) => number | undefined;
	/** The described element a step acts on, resolved against a fresh read right before it runs. */
	readonly target: (step: RunStep) => StepTarget | undefined;
	readonly wait: (step: RunStep) => StepWait | undefined;
	/** The same step naming the element its target resolved to. */
	readonly resolve: (step: RunStep, elementIndex: number) => RunStep;
	/** The same step aimed at a screen point (global logical points) where text was read from the window's pixels. */
	readonly resolveAtPoint: (step: RunStep, observation: InputObservation, point: Point) => RunStep;
	readonly validate: (step: RunStep, observation: InputObservation) => void;
	readonly dispatch: (step: RunStep, targetPid: number, observation: InputObservation) => Promise<StepDispatch>;
}

// biome-ignore lint/suspicious/noConfusingVoidType: a mutation may report how it dispatched input, or report nothing when its route is not known to it
type Mutation = (targetPid: number, observation: InputObservation) => Promise<ActionDispatch | void>;
type Validation = (observation: InputObservation) => void;
type ObservedElementIdentity = ReadonlyMap<
	number,
	{ readonly role: string; readonly label: string | null; readonly y: number }
>;

type TargetLookup<T> = { readonly found: T } | { readonly missing: string };
type ElementFinder<T> = (elements: ReadonlyMap<number, AXTreeElement>) => TargetLookup<T>;

/** What a run_steps chain resolves its element targets against, and whether to keep that read between steps. */
type ChainTree = ScrollFindChain;

function findQueryTarget(target: StepTarget): ElementFinder<ReturnType<typeof matchElements>[number]> {
	return (elements) => {
		const match = matchElements([...elements.values()], target.query)[target.index];
		return match === undefined
			? {
					missing: `no element in the current window matches ${describeQuery(target.query)}${target.index > 0 ? ` at position ${target.index}` : ""}`,
				}
			: { found: match };
	};
}

function findObservedElement(
	elementIndex: number,
	observedIdentity: ReturnType<ObservedElementIdentity["get"]>,
): ElementFinder<AXTreeElement> {
	return (elements) => {
		const element = elements.get(elementIndex);
		if (element === undefined) {
			return { missing: `element ${elementIndex} is not present in the latest observation` };
		}
		return observedIdentity !== undefined && !sameElementIdentity(observedIdentity, element)
			? {
					missing: `element ${elementIndex} is now ${element.role} "${element.label ?? ""}", not the observed control; re-observe`,
				}
			: { found: element };
	};
}

/** A refusal to dispatch input: nothing was sent, and the caller must be told why. */
class InputRefusal extends Error {
	constructor(
		readonly reason: string,
		detail?: string,
	) {
		super(detail ?? `input refused: ${reason}`);
	}
}

/**
 * How long the tree read after an action may stand in for the next action's pre-dispatch read. The
 * outcome read already waited for the UI to settle, so only a script's own glue code runs in between;
 * anything slower falls back to a fresh read.
 */
const READ_REUSE_MILLISECONDS = 300;

/** Steps that act on screen points, so a moved or resized window must stop a fast-paced chain. */
const POINTER_STEP_TYPES: ReadonlySet<string> = new Set(["click", "drag", "scroll"]);

const FAST_PACE_NOTE =
	"pace: fast - the steps ran back to back without reading the UI between them (the stop switch and the window were still checked before each step); intermediate states were not individually read, only the final outcome was.";

/** A settled, complete tree read that is still the app's latest observation. */
interface ReusableRead {
	readonly observation: InputObservation;
	readonly elements: ReadonlyMap<number, AXTreeElement>;
	readonly at: number;
}

interface LiveToken {
	readonly token: string;
	readonly observation: InputObservation;
	readonly elements: ObservedElementIdentity | undefined;
}

export class GuardedSession {
	private readonly tokens = new Map<string, LiveToken>();
	private readonly tokenByPid = new Map<number, string>();
	private readonly reusableReads = new Map<number, ReusableRead>();
	private readonly resolvedAppPids = new Map<string, number>();
	private readonly tails = new Map<number, Promise<void>>();
	private globalTail: Promise<void> = Promise.resolve();
	private closed = false;
	private closePromise: Promise<void> | undefined;

	constructor(
		private readonly computer: GuardedComputerInterface,
		private readonly windowProbe?: () => Promise<readonly TopLevelWindow[]>,
		private readonly appLauncher?: AppOpenLauncher,
		private readonly systemPromptProbe?: () => readonly SystemPrompt[],
		private readonly stopSwitch?: StopStatusSource,
	) {}

	listApps(): Promise<ToolResult> {
		return this.enqueue(undefined, async () => textResult(JSON.stringify(await this.computer.listApps(), null, 2)));
	}

	listWindows(): Promise<ToolResult> {
		return this.enqueue(undefined, async () => {
			const windows = this.windowProbe === undefined ? [] : await this.windowProbe();
			const prompts = this.systemPromptProbe === undefined ? [] : this.systemPromptProbe();
			return textResult(
				JSON.stringify(
					{
						windows: windows.map((window) => ({
							window_id: window.id,
							pid: window.ownerPid,
							app: window.ownerName,
							title: window.title,
							bounds: window.bounds,
						})),
						...(prompts.length > 0
							? { system_prompts: prompts.map(describeSystemPrompt), system_prompt_note: SYSTEM_PROMPT_NOTE }
							: {}),
					},
					null,
					2,
				),
			);
		});
	}

	async observe(request: ObserveRequest): Promise<ToolResult> {
		const targetPid = await this.resolvePid(request.app);
		return this.enqueue(targetPid, async () => {
			this.clearTokenFor(targetPid);
			const state = await this.computer.getAppState(targetPid, {
				...(request.diffOnly ? STRICT_DIFF_STATE_OPTIONS : STRICT_STATE_OPTIONS),
				...(request.includeScreenshot === undefined ? {} : { includeScreenshot: request.includeScreenshot }),
				...(request.includeAccessibilityTree === undefined
					? {}
					: { includeAccessibilityTree: request.includeAccessibilityTree }),
				...(request.settleMs === undefined ? {} : { settleMs: request.settleMs }),
				...(request.windowId === undefined ? {} : { windowId: request.windowId }),
				...(request.maxElements === undefined ? {} : { maxElements: request.maxElements }),
				...(request.includeMenuBar === undefined ? {} : { includeMenuBar: request.includeMenuBar }),
				...(request.subtreeOf === undefined ? {} : { subtreeOf: request.subtreeOf }),
			});
			this.assertOpen();
			const observation = this.computer.getInputObservation(targetPid);
			const token = this.issueForObservation(observation, state);
			if (
				token !== undefined &&
				request.windowId === undefined &&
				request.maxElements === undefined &&
				request.includeMenuBar === undefined &&
				request.subtreeOf === undefined
			) {
				this.rememberRead(targetPid, observation, state);
			}
			return stateResult(state, token, request.elementFormat);
		});
	}

	/**
	 * Answer "what is this thing I am describing?" without spreading the whole tree: one
	 * accessibility walk (no pixels unless asked), the ranked matches with their ids, and the
	 * one-use token for those ids. A miss is an honest answer that names near misses.
	 */
	findElements(request: FindElementsRequest): Promise<ToolResult> {
		return this.lookupApp(request.app, async (targetPid) =>
			this.enqueue(targetPid, async () => {
				this.clearTokenFor(targetPid);
				const observed = await this.observeApp(targetPid, {
					includeScreenshot: request.includeScreenshot === true,
					...(request.windowId === undefined ? {} : { windowId: request.windowId }),
					...(request.maxElements === undefined ? {} : { maxElements: request.maxElements }),
				});
				const query = describeQuery(request.query);
				const matches = matchElements(observed.state.elements, request.query);
				const found = matches.length > 0;
				return targetStateResult(
					observed.state,
					{
						found,
						query,
						matchCount: matches.length,
						matches: matches
							.slice(0, request.maxResults ?? DEFAULT_FIND_RESULTS)
							.map((match) => compactElementMatch(match)),
						...(found
							? {}
							: {
									nearMisses: suggestNearMisses(observed.state.elements, request.query, MAX_NEAR_MISSES).map(
										(element) => compactElement(element),
									),
									message: `no element matched ${query}; nothing was clicked or changed. The near misses name what this screen offers.`,
								}),
					},
					{
						token: this.issueForObservation(observed.observation, observed.state),
						includeScreenshot: request.includeScreenshot === true,
					},
				);
			}),
		);
	}

	/**
	 * Act on a described element in one call: resolve it, wait for it to appear when the caller
	 * gave patience, dispatch through the route the control supports, and answer with the fresh
	 * outcome. A miss dispatches nothing and names what the screen did offer.
	 */
	clickTarget(request: ClickTargetRequest, dispatchTarget: ResolvedTargetDispatcher): Promise<ToolResult> {
		return this.lookupApp(request.app, async (targetPid) =>
			this.enqueue(targetPid, async () => {
				this.clearTokenFor(targetPid);
				const startedAt = Date.now();
				const deadline = startedAt + (request.timeoutMs ?? 0);
				const includeScreenshot = request.includeScreenshot === true;
				const observationOptions = {
					includeScreenshot,
					...(request.windowId === undefined ? {} : { windowId: request.windowId }),
				};
				const index = request.index ?? 0;
				let attempts = 1;
				let observed = await this.observeApp(targetPid, observationOptions);
				let matches = matchElements(observed.state.elements, request.query);
				let match: ElementMatch | undefined = matches[index];
				while (match === undefined && Date.now() < deadline) {
					await delayMilliseconds(Math.min(TARGET_POLL_INTERVAL_MILLISECONDS, Math.max(1, deadline - Date.now())));
					this.assertOpen();
					observed = await this.observeApp(targetPid, observationOptions);
					attempts += 1;
					matches = matchElements(observed.state.elements, request.query);
					match = matches[index];
				}
				const query = describeQuery(request.query);
				const waitedMs = Date.now() - startedAt;
				if (match === undefined) {
					return targetStateResult(
						observed.state,
						{
							found: false,
							actionDispatched: false,
							query,
							attempts,
							waitedMs,
							matchCount: matches.length,
							alternatives: matches
								.slice(0, MAX_ALTERNATIVES)
								.map((candidate) => compactElement(candidate.element)),
							nearMisses:
								matches.length > 0
									? []
									: suggestNearMisses(observed.state.elements, request.query, MAX_NEAR_MISSES).map((element) =>
											compactElement(element),
										),
							message:
								matches.length > 0
									? `no match at index ${index}; the alternatives are the matches that do exist. Nothing was dispatched.`
									: `no element matched ${query} after ${attempts} observation(s); nothing was dispatched. The near misses name what this screen offers.`,
						},
						{
							token: this.issueForObservation(observed.observation, observed.state),
							includeScreenshot,
							includeElements: request.fullState === true,
						},
					);
				}
				const target = match.element;
				const observation = observed.observation;
				if (observation === undefined) {
					return refusalResult(
						"no-observation",
						"the accessibility walk produced no observation to act on; retry",
					);
				}
				const stopped = this.userStopped();
				if (stopped !== undefined) {
					return refusalResult(stopped.reason, stopped.message);
				}
				const preflight = await this.computer.preflightInput(observation);
				if (!preflight.ok) {
					this.clearTokenFor(targetPid);
					return refusalResult(preflight.reason);
				}
				this.assertOpen();
				const beforeAction = await this.captureWindowBaseline();
				const dispatch = await dispatchTarget(targetPid, observation, {
					elementIndex: target.id,
					actions: target.actions,
					frame: target.frame,
					...(request.press === undefined ? {} : { press: request.press }),
					...(request.hoverFirst === undefined ? {} : { hoverFirst: request.hoverFirst }),
					...(request.clickCount === undefined ? {} : { clickCount: request.clickCount }),
					...(request.mouseButton === undefined ? {} : { mouseButton: request.mouseButton }),
				});
				try {
					// Verify against a dedicated read (the same shape verify_state uses) instead of against the
					// outcome diff, which carries no tree: the answer then keeps the proof and the diff without
					// shipping the whole accessibility tree back.
					const verification =
						request.expect === undefined
							? undefined
							: (await this.pollVerification(targetPid, request.expect)).verification;
					const outcome = await this.readOutcome(targetPid, observation, {
						fullState: request.fullState === true,
						includeScreenshot,
					});
					const windowEvents = await this.describeWindowSideEffects(beforeAction);
					return observedActionResult(
						outcome.state,
						outcome.contextUnchanged,
						outcome.nextToken,
						windowEvents,
						dispatch,
						{
							found: true,
							query,
							attempts,
							waitedMs,
							target: compactElementMatch(match),
							matchCount: matches.length,
							...(matches.length > 1
								? {
										alternatives: matches
											.filter((candidate) => candidate.element.id !== target.id)
											.slice(0, MAX_ALTERNATIVES)
											.map((candidate) => compactElement(candidate.element)),
									}
								: {}),
							...(verification === undefined ? {} : { verification }),
						},
					);
				} catch (error: unknown) {
					this.clearTokenFor(targetPid);
					return postActionErrorResult(error, {
						found: true,
						query,
						attempts,
						target: compactElementMatch(match),
					});
				}
			}),
		);
	}

	/**
	 * Open an app the way a person means it: bring it forward when it runs, launch it when it
	 * does not, and wait until it is observable. Opening authorizes no observation and no input.
	 */
	openApp(request: OpenAppRequest): Promise<ToolResult> {
		return this.enqueue(undefined, async () => {
			const launcher = this.appLauncher;
			if (launcher === undefined) {
				return openAppResult({ opened: false, name: request.name }, "this session has no app launcher");
			}
			try {
				const result = await openApplication(this.computer, request.name, {
					launcher,
					...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
				});
				return openAppResult({ opened: true, ...result }, undefined);
			} catch (error: unknown) {
				return openAppResult(
					{ opened: false, name: request.name },
					error instanceof Error ? error.message : String(error),
				);
			}
		});
	}

	/** Resolve an app name to a pid, or answer honestly that it is not running. */
	private async lookupApp(app: string, run: (targetPid: number) => Promise<ToolResult>): Promise<ToolResult> {
		let targetPid: number;
		try {
			targetPid = await this.resolvePid(app);
		} catch (error: unknown) {
			return appNotRunningResult(app, error instanceof Error ? error.message : String(error));
		}
		return await run(targetPid);
	}

	/**
	 * One accessibility walk for a targeting call, without taking the app's lane, so a caller that
	 * already holds it can poll with it. Pixels are captured only when the caller asked for them.
	 */
	private async observeApp(
		targetPid: number,
		options: { readonly includeScreenshot: boolean; readonly windowId?: number; readonly maxElements?: number },
	): Promise<{ readonly state: AppState; readonly observation: InputObservation | undefined }> {
		const state = await this.computer.getAppState(targetPid, {
			...STRICT_STATE_OPTIONS,
			includeScreenshot: options.includeScreenshot,
			...(options.windowId === undefined ? {} : { windowId: options.windowId }),
			...(options.maxElements === undefined ? {} : { maxElements: options.maxElements }),
		});
		this.assertOpen();
		return { state, observation: this.computer.getInputObservation(targetPid) };
	}

	/** The one-use token for an observation whose element ids are current, or nothing when they are not. */
	private issueForObservation(observation: InputObservation | undefined, state: AppState): string | undefined {
		return observation !== undefined && state.treeSkipped !== true && observationMatchesState(observation, state)
			? this.issue(observation, observedElementIdentity(state))
			: undefined;
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
				expected = await this.beginMutation(token, app, validate, options.screenPoints === true);
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
				expected = await this.beginMutation(token, app, () => undefined, false);
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
			let refused: string | undefined;

			for (const { update, index } of targets) {
				const stopped = this.userStopped();
				if (stopped !== undefined) {
					steps.push(skippedStep(index, update.value, stopped.message));
					stoppedEarly = true;
					refused = stopped.reason;
					break;
				}
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

			const report = {
				...summarize(steps, updates.length, stoppedEarly, uiChanged),
				...(refused === undefined ? {} : { refused }),
			};
			try {
				const outcome = await this.readOutcome(expected.pid, expected.observation, options);
				return observedSetFieldsResult(outcome.state, report, outcome.contextUnchanged, outcome.nextToken);
			} catch (error: unknown) {
				this.clearTokenFor(expected.pid);
				return postActionErrorResult(error, { setFields: report });
			}
		});
	}

	runSteps(
		token: string,
		app: string,
		steps: readonly RunStep[],
		expect: VerifyRequest | undefined,
		driver: RunStepDriver,
		options: MutationOptions = {},
		control: RunControl = {},
	): Promise<ToolResult> {
		return this.enqueue(this.laneForRequestedToken(token), async () => {
			let expected: Awaited<ReturnType<typeof this.beginMutation>>;
			try {
				expected = await this.beginMutation(
					token,
					app,
					(observation) => {
						for (const step of steps) {
							driver.validate(step, observation);
						}
					},
					steps.some(
						(step) =>
							step.type === "drag" ||
							(step.type === "click" && step.element_index === undefined && step.target === undefined),
					),
				);
			} catch (error: unknown) {
				const refused = this.refusalFrom(error);
				if (refused !== undefined) {
					return refused;
				}
				throw error;
			}
			const beforeAction = await this.captureWindowBaseline();
			const reports: RunStepReport[] = [];
			let stoppedEarly = false;
			let refused: string | undefined;
			// The settled read behind the token can answer the first pre-dispatch read, but only until this
			// batch waits or dispatches: from then on the UI is what the batch itself made of it.
			let canReuseRead = true;
			let treeReads = 0;
			const readBaseline = async (): ReturnType<GuardedSession["readFieldBaseline"]> => {
				const reusable = canReuseRead ? this.takeReusableRead(expected.observation) : undefined;
				canReuseRead = false;
				if (reusable !== undefined) {
					return { elements: reusable, changed: false };
				}
				treeReads += 1;
				return await this.readFieldBaseline(expected.pid);
			};
			// Fast pace keeps the chain's one read until a wait or a miss makes it stale, and runs the cheap
			// guard that stands in for a read between steps once something has run.
			const fast = control.pace === "fast";
			const chain: ChainTree = {
				keep: fast,
				elements: undefined,
				changed: false,
				framesStale: false,
				idsRebased: false,
				read: readBaseline,
			};
			let guardNeeded = false;

			for (const [position, step] of steps.entries()) {
				const stopped = this.userStopped();
				if (stopped !== undefined) {
					for (const [remaining, skipped] of steps.entries()) {
						if (remaining >= position) {
							reports.push(skippedRunStep(remaining, skipped.type, stopped.message));
						}
					}
					stoppedEarly = true;
					refused = stopped.reason;
					break;
				}
				if (control.signal?.aborted === true) {
					for (const [remaining, skipped] of steps.entries()) {
						if (remaining >= position) {
							reports.push(
								skippedRunStep(remaining, skipped.type, "cancelled by the client before this step ran"),
							);
						}
					}
					stoppedEarly = true;
					break;
				}

				const wait = driver.wait(step);
				if (wait !== undefined) {
					canReuseRead = false;
					chain.elements = undefined;
					guardNeeded = true;
					const waited = await this.waitForStep(expected.pid, wait, control.signal);
					chain.changed = chain.changed || waited.changed;
					if (!waited.satisfied) {
						reports.push({
							step: position,
							type: step.type,
							input_dispatched: false,
							status: "failed",
							reason: waited.reason,
						});
						stoppedEarly = true;
						break;
					}
					reports.push({
						step: position,
						type: step.type,
						input_dispatched: false,
						status: "satisfied",
						detail: { waited_ms: waited.waitedMs },
					});
					control.onProgress?.(position + 1, steps.length, `${step.type} satisfied`);
					continue;
				}

				let runnable = step;
				let resolvedElement:
					| { readonly id: number; readonly role: string; readonly label: string | null }
					| undefined;
				let foundEvidence: FindEvidence | undefined;
				const target = driver.target(step);
				if (target?.find !== undefined) {
					const searched = await this.searchByScrolling(chain, expected, step, target, target.find, control);
					if ("missing" in searched) {
						reports.push({ ...skippedRunStep(position, step.type, searched.missing), found: searched.evidence });
						stoppedEarly = true;
						if (searched.refused !== undefined) {
							refused = searched.refused;
						}
						break;
					}
					foundEvidence = searched.evidence;
					if (searched.found.kind === "element") {
						const element = searched.found.element;
						resolvedElement = { id: element.id, role: element.role, label: element.label };
						// A control that does not advertise AXPress (a Finder row's name field) takes no accessibility
						// press, so its click goes to the centre the search just measured, through the pointer route.
						const pointerClick = step.type === "click" && !element.actions.includes(AX_PRESS_ACTION);
						runnable = pointerClick
							? driver.resolveAtPoint(step, expected.observation, searched.found.centre)
							: driver.resolve(step, element.id);
					} else {
						try {
							runnable = driver.resolveAtPoint(step, expected.observation, searched.found.point);
						} catch (error: unknown) {
							reports.push({
								...skippedRunStep(position, step.type, error instanceof Error ? error.message : String(error)),
								found: searched.evidence,
							});
							stoppedEarly = true;
							break;
						}
					}
				} else if (target !== undefined) {
					const located = await this.resolveStepTarget(chain, findQueryTarget(target));
					if ("missing" in located) {
						reports.push(skippedRunStep(position, step.type, located.missing));
						stoppedEarly = true;
						break;
					}
					const match = located.found;
					resolvedElement = { id: match.element.id, role: match.element.role, label: match.element.label };
					runnable = driver.resolve(step, match.element.id);
				}

				const elementIndex = target === undefined ? driver.elementIndex(step) : undefined;
				if (elementIndex !== undefined && chain.idsRebased && chain.elements !== undefined) {
					reports.push(
						skippedRunStep(
							position,
							step.type,
							"element ids were renumbered by an earlier scroll-find in this chain; name this step's element with target",
						),
					);
					stoppedEarly = true;
					break;
				}
				if (elementIndex !== undefined) {
					const located = await this.resolveStepTarget(
						chain,
						findObservedElement(elementIndex, expected.elements?.get(elementIndex)),
					);
					if ("missing" in located) {
						reports.push(skippedRunStep(position, step.type, located.missing));
						stoppedEarly = true;
						break;
					}
				}

				if (fast && guardNeeded) {
					const blocked = await this.chainGuard(expected.pid, expected.observation, step);
					if (blocked !== undefined) {
						const reason = `the window guard refused this step (${blocked}); nothing further was dispatched`;
						for (const [remaining, skipped] of steps.entries()) {
							if (remaining >= position) {
								reports.push(skippedRunStep(remaining, skipped.type, reason));
							}
						}
						stoppedEarly = true;
						refused = blocked;
						break;
					}
				}

				canReuseRead = false;
				guardNeeded = true;
				try {
					const dispatch = await timed("dispatch", () =>
						driver.dispatch(runnable, expected.pid, expected.observation),
					);
					reports.push({
						step: position,
						type: step.type,
						input_dispatched: true,
						status: "dispatched",
						route: dispatch.route,
						delivery: dispatch.delivery,
						...(dispatch.fallback === undefined ? {} : { fallback: dispatch.fallback }),
						...(resolvedElement === undefined ? {} : { resolved_element: resolvedElement }),
						...(foundEvidence === undefined ? {} : { found: foundEvidence }),
						...(dispatch.detail === undefined ? {} : { detail: dispatch.detail }),
					});
					control.onProgress?.(position + 1, steps.length, `${step.type} dispatched`);
				} catch (error: unknown) {
					reports.push({
						step: position,
						type: step.type,
						input_dispatched: false,
						status: "failed",
						reason: error instanceof Error ? error.message : String(error),
					});
					stoppedEarly = true;
					break;
				}
			}

			const report = {
				...summarizeRunSteps(reports, steps.length, stoppedEarly, chain.changed),
				...(refused === undefined ? {} : { refused }),
				...(fast
					? {
							pace: "fast",
							pace_note: FAST_PACE_NOTE,
							tree_reads: treeReads,
						}
					: {}),
			};
			try {
				if (expect?.timeoutMs !== undefined) {
					await this.pollVerification(expected.pid, expect);
				}
				const outcome = await this.readOutcome(
					expected.pid,
					expected.observation,
					expect?.checks !== undefined && expect.checks.length > 0 ? { ...options, fullState: true } : options,
				);
				const verification =
					expect === undefined ? undefined : await this.runChecks(expected.pid, outcome.state, expect);
				const windowEvents = await this.describeWindowSideEffects(beforeAction);
				return observedRunStepsResult(
					outcome.state,
					report,
					verification,
					outcome.contextUnchanged,
					outcome.nextToken,
					windowEvents,
				);
			} catch (error: unknown) {
				this.clearTokenFor(expected.pid);
				return postActionErrorResult(error, { runSteps: report });
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
			const targetPid = await this.resolvePidForToken(app, active.observation.pid);
			if (targetPid !== active.observation.pid) {
				throw new Error("requested app does not match the token observation");
			}
			const { state, verification } = await this.pollVerification(targetPid, request, active.observation.windowId);
			const observation = this.computer.getInputObservation(targetPid);
			const nextToken =
				observation !== undefined && observationMatchesState(observation, state)
					? this.issue(observation, observedElementIdentity(state))
					: undefined;
			return verificationResult(verification, state, nextToken);
		});
	}

	private async waitForStep(
		targetPid: number,
		wait: StepWait,
		signal: AbortSignal | undefined,
	): Promise<{
		readonly satisfied: boolean;
		readonly changed: boolean;
		readonly waitedMs: number;
		readonly reason: string;
	}> {
		const startedAt = Date.now();
		const deadline = startedAt + wait.timeoutMs;
		let changed = false;
		for (;;) {
			this.assertOpen();
			const state = await this.computer.getAppState(targetPid, {
				...STRICT_STATE_OPTIONS,
				includeScreenshot: false,
				settleMs: 0,
			});
			this.assertOpen();
			changed = changed || hasAxChange(state);
			const unmet: string[] = [];
			if (wait.query !== undefined) {
				const present = matchElements(state.elements, wait.query).length > 0;
				if (present === wait.gone) {
					unmet.push(`${describeQuery(wait.query)} is ${wait.gone ? "still shown" : "not shown"}`);
				}
			}
			if (wait.windowTitle !== undefined) {
				const titles = (await this.windowsForPid(targetPid)).map((window) => window.title);
				if (state.windowTitle !== undefined && !titles.includes(state.windowTitle)) {
					titles.push(state.windowTitle);
				}
				if (!titles.includes(wait.windowTitle)) {
					unmet.push(`no window titled ${JSON.stringify(wait.windowTitle)} is open`);
				}
			}
			const waitedMs = Date.now() - startedAt;
			if (unmet.length === 0) {
				return { satisfied: true, changed, waitedMs, reason: "" };
			}
			if (signal?.aborted === true) {
				return { satisfied: false, changed, waitedMs, reason: "cancelled by the client while waiting" };
			}
			if (Date.now() >= deadline) {
				return { satisfied: false, changed, waitedMs, reason: `after ${waitedMs} ms: ${unmet.join("; ")}` };
			}
			await delayMilliseconds(VERIFY_POLL_INTERVAL_MILLISECONDS);
		}
	}

	private async pollVerification(
		targetPid: number,
		request: VerifyRequest,
		windowId?: number,
	): Promise<{ readonly state: AppState; readonly verification: Verification }> {
		const deadline = Date.now() + (request.timeoutMs ?? 0);
		for (;;) {
			this.assertOpen();
			const state = await this.computer.getAppState(targetPid, {
				...STRICT_STATE_OPTIONS,
				includeScreenshot: false,
				settleMs: 0,
				...(windowId === undefined ? {} : { windowId }),
			});
			this.assertOpen();
			const verification = await this.runChecks(targetPid, state, request);
			if (verification.verified || Date.now() >= deadline) {
				return { state, verification };
			}
			await delayMilliseconds(VERIFY_POLL_INTERVAL_MILLISECONDS);
		}
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
			if (state.windowTitle !== undefined && !titles.includes(state.windowTitle)) {
				titles.push(state.windowTitle);
			}
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
		screenPoints: boolean,
	): Promise<{
		readonly pid: number;
		readonly observation: InputObservation;
		readonly elements: ObservedElementIdentity | undefined;
	}> {
		const stopped = this.userStopped();
		if (stopped !== undefined) {
			throw stopped;
		}
		let active: ReturnType<GuardedSession["consume"]>;
		try {
			active = this.consume(token);
		} catch (error: unknown) {
			throw new InputRefusal("stale-observation-token", error instanceof Error ? error.message : undefined);
		}
		const targetPid = await this.resolvePidForToken(app, active.observation.pid);
		if (targetPid !== active.observation.pid) {
			throw new InputRefusal("token-observation-mismatch", "requested app does not match the token observation");
		}
		try {
			validate(active.observation);
		} catch (error: unknown) {
			throw new InputRefusal("element-not-observed", error instanceof Error ? error.message : undefined);
		}
		const preflight = await timed("preflightInput", () =>
			this.computer.preflightInput(active.observation, { requireSameBounds: screenPoints }),
		);
		if (!preflight.ok) {
			this.resolvedAppPids.delete(appKey(app));
			throw new InputRefusal(preflight.reason);
		}
		this.assertOpen();
		return { pid: targetPid, observation: active.observation, elements: active.elements };
	}

	/**
	 * THE seam where a run_steps chain turns what a step names (a described target or an element id) into
	 * an element. Verified pace reads the UI first, every time. Fast pace tries the chain's one read first
	 * and reads again, for this step only, when the element is not in it (UI an earlier step created);
	 * the fresh read then becomes the chain's tree, because ids belong to the snapshot they came from.
	 * Anything that finds elements the plain read cannot (scrolling a list until the row exists, text
	 * recognition when no accessibility element matches) extends this function, not the chain loop.
	 */
	private async resolveStepTarget<T>(chain: ChainTree, find: ElementFinder<T>): Promise<TargetLookup<T>> {
		// Frames a scroll in this chain moved cannot be trusted to aim an action, so they force a fresh read.
		if (chain.elements !== undefined && !chain.framesStale) {
			const attempt = find(chain.elements);
			if ("found" in attempt) {
				return attempt;
			}
		}
		const baseline = await chain.read();
		chain.changed = chain.changed || baseline.changed;
		chain.framesStale = false;
		chain.idsRebased = false;
		chain.elements = chain.keep ? baseline.elements : undefined;
		return find(baseline.elements);
	}

	/**
	 * A step that names its target with `find`: look at what is shown (accessibility, then the window's pixels),
	 * scroll the area a page and look again, and stop at the first sighting. The stop switch, the cancel signal and
	 * the window guards are checked before every look, so a long search can be stopped between pages.
	 */
	private async searchByScrolling(
		chain: ChainTree,
		expected: { readonly pid: number; readonly observation: InputObservation },
		step: RunStep,
		target: StepTarget,
		find: StepFind,
		control: RunControl,
	): Promise<ScrollFindResult> {
		return await findByScrolling(
			{
				computer: this.computer,
				pid: expected.pid,
				observation: expected.observation,
				interrupted: async (scrolled) => {
					this.assertOpen();
					const stopped = this.userStopped();
					if (stopped !== undefined) {
						return { message: stopped.message, refused: stopped.reason };
					}
					if (control.signal?.aborted === true) {
						return { message: "cancelled by the client while looking for the target" };
					}
					if (!scrolled) {
						return undefined;
					}
					const blocked = await this.chainGuard(expected.pid, expected.observation, step);
					return blocked === undefined
						? undefined
						: {
								message: `the window guard refused the search (${blocked}); nothing further was dispatched`,
								refused: blocked,
							};
				},
			},
			chain,
			target.query,
			target.index,
			find,
		);
	}

	/**
	 * The cheap check that stands in for a tree read between fast-paced steps: the window the chain was
	 * observed on is still the same window (and, for steps that aim at screen points, the same bounds),
	 * the app is still approved and running, and the observation was not replaced. A reason means refuse.
	 */
	private async chainGuard(pid: number, observed: InputObservation, step: RunStep): Promise<string | undefined> {
		const pointer = POINTER_STEP_TYPES.has(step.type);
		const current = this.computer.getInputObservation(pid);
		if (current === undefined) {
			return "observation-replaced";
		}
		if (current !== observed) {
			if (
				current.pid !== observed.pid ||
				current.bundleId !== observed.bundleId ||
				current.windowId !== observed.windowId
			) {
				return "window-changed";
			}
			if (pointer && !sameInputContext(observed, current)) {
				return "window-bounds-changed";
			}
		}
		const result = await timed("chainGuard", () =>
			this.computer.preflightInput(current, { requireSameBounds: pointer }),
		);
		return result.ok ? undefined : result.reason;
	}

	/** The refusal to raise while the user's stop switch is on, or nothing while computer use is allowed. */
	private userStopped(): InputRefusal | undefined {
		const status = this.stopSwitch?.status();
		return status?.stopped === true ? new InputRefusal("user-stopped", describeUserStop(status)) : undefined;
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
		// A retained read asks for the whole tree and answers with the same diff-only state the walk would
		// have produced on its own.
		const retain = options.retainTree === true && options.fullState !== true;
		const read = await timed("readOutcome.getAppState", () =>
			this.computer.getAppState(targetPid, {
				...(options.fullState === true || retain ? STRICT_STATE_OPTIONS : STRICT_DIFF_STATE_OPTIONS),
				includeScreenshot: options.includeScreenshot === true,
			}),
		);
		const state: AppState =
			retain && read.axChangeSummary !== undefined && read.treeSkipped !== true
				? { ...read, elements: [], treeOmitted: true }
				: read;
		this.assertOpen();
		const current = this.computer.getInputObservation(targetPid);
		// Background delivery acts on a window that is deliberately not frontmost, so requiring focus
		// here withheld the next token after every background action and cost a full re-observation.
		// A post-action read that produced a comparable tree is itself a fresh observation, so it earns
		// a token whether or not the tree changed; only an unavailable tree still pauses.
		const focusSatisfied = state.frontmost || this.computer.delivery === "background";
		const contextUnchanged =
			current !== undefined &&
			focusSatisfied &&
			observationMatchesState(current, state) &&
			sameInputContext(expected, current);
		const nextToken =
			contextUnchanged && state.axChangeSummary !== undefined ? this.issue(current, undefined) : undefined;
		if (nextToken !== undefined) {
			this.rememberRead(targetPid, current, read);
		}
		return { state, contextUnchanged, nextToken };
	}

	private async readFieldBaseline(targetPid: number): Promise<{
		readonly elements: ReadonlyMap<number, AXTreeElement>;
		readonly changed: boolean;
	}> {
		this.assertOpen();
		const state = await timed("readFieldBaseline.getAppState", () =>
			this.computer.getAppState(targetPid, FIELD_VERIFY_STATE_OPTIONS),
		);
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
		const probe = this.windowProbe;
		try {
			return (await timed("windowProbe.before", () => probe())).map((window) => window.id);
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
			const probe = this.windowProbe;
			return (await timed("windowProbe.after", () => probe()))
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
		this.reusableReads.delete(pid);
		const token = this.tokenByPid.get(pid);
		if (token !== undefined) {
			this.tokens.delete(token);
			this.tokenByPid.delete(pid);
		}
	}

	/** Resolve an app name to a pid, remembering the answer for later requests naming the same app. */
	private async resolvePid(app: string): Promise<number> {
		const pid = await timed("resolveAppPid", () => resolveAppPid(this.computer, app));
		this.resolvedAppPids.set(appKey(app), pid);
		return pid;
	}

	/**
	 * The pid a token-carrying request names. When this session already resolved the same app name to the
	 * token's pid, enumerating every running app again (the dominant cost of a small action) adds nothing:
	 * preflight still proves that exact process is running, is the observed bundle and is approved.
	 */
	private async resolvePidForToken(app: string, tokenPid: number): Promise<number> {
		return this.resolvedAppPids.get(appKey(app)) === tokenPid ? tokenPid : await this.resolvePid(app);
	}

	/** Keep the complete tree of a settled read so the next action can resolve its target against it. */
	private rememberRead(pid: number, observation: InputObservation | undefined, state: AppState): void {
		if (
			observation === undefined ||
			state.treeSkipped === true ||
			state.treeOmitted === true ||
			state.elementsTruncated === true ||
			!observationMatchesState(observation, state)
		) {
			this.reusableReads.delete(pid);
			return;
		}
		this.reusableReads.set(pid, {
			observation,
			elements: new Map(state.elements.map((element) => [element.id, element] as const)),
			at: Date.now(),
		});
	}

	/**
	 * The tree of the read that produced `expected`, once. It stands in for a fresh read only while that
	 * read is still the app's latest observation (nothing observed or acted since) and younger than
	 * {@link READ_REUSE_MILLISECONDS}.
	 */
	private takeReusableRead(expected: InputObservation): ReadonlyMap<number, AXTreeElement> | undefined {
		const entry = this.reusableReads.get(expected.pid);
		this.reusableReads.delete(expected.pid);
		if (
			entry === undefined ||
			entry.observation !== expected ||
			Date.now() - entry.at > READ_REUSE_MILLISECONDS ||
			this.computer.getInputObservation(expected.pid) !== expected
		) {
			return undefined;
		}
		return entry.elements;
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

	private enqueue(lane: number | undefined, operation: () => Promise<ToolResult>): Promise<ToolResult> {
		const previous = lane === undefined ? this.globalTail : (this.tails.get(lane) ?? Promise.resolve());
		// A locked Mac is not a tool failure: it answers as a refusal that asks for the person.
		const result = previous
			.then(async () => {
				this.assertOpen();
				return await operation();
			})
			.catch((error: unknown) => lockRefusalResult(error) ?? Promise.reject(error));
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

function appKey(app: string): string {
	return app.trim().toLowerCase();
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

function skippedRunStep(position: number, type: string, reason: string): RunStepReport {
	return {
		step: position,
		type,
		input_dispatched: false,
		status: "skipped",
		reason,
	};
}

function summarizeRunSteps(
	steps: readonly RunStepReport[],
	requested: number,
	stoppedEarly: boolean,
	uiChanged: boolean,
): RunStepsReport {
	return {
		requested,
		completed: steps.filter((step) => step.input_dispatched).length,
		stoppedEarly,
		uiChanged,
		steps,
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
