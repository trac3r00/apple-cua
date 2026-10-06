import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ElementQuery, GuardedComputerInterface, TopLevelWindow } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { GuardedSession, RunPace, RunStepDriver, VerifyCheckRequest, VerifyRequest } from "./guarded-session.js";
import type {
	CallError,
	HostMessage,
	ScriptOutcome,
	WindowSelector,
	WorkerMessage,
	WorkerTarget,
} from "./script-protocol.js";
import { createRunStepDriver } from "./step-actions.js";
import type { ToolContent, ToolResult } from "./tool-result.js";
import { MAX_RUN_STEPS, elementQuerySchema, runStepSchema } from "./tool-schemas.js";
import type { RunStep } from "./tool-schemas.js";

const MAX_CODE_LENGTH = 20_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_EXPECT_TIMEOUT_MS = 10_000;
const MAX_LOG_ENTRIES = 200;
const MAX_LOG_CHARS = 2_000;
const MAX_FIND_RESULTS = 25;
const MAX_BATCH_STEPS = MAX_RUN_STEPS;

const runScriptSchema = z.object({
	code: z.string().min(1).max(MAX_CODE_LENGTH),
	timeout_ms: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional(),
	read_only: z.boolean().optional(),
	include_screenshot: z.boolean().optional(),
});

const RUN_SCRIPT_DESCRIPTION = `Run a whole flow in ONE call as the body of an async JavaScript function (loops, branches, reads) instead of a round trip per action. Nothing persists across calls. Every action goes through the guarded mutation path (token, allowlist/approval, preflight, read-back). NOT a security sandbox: no require/process/import, but the code has the calling agent's trust; never run untrusted code.
API (all async; target = element id (number|string) or query {role,label,label_contains,value_contains,text,index}):
const app = apple.app("Finder"); await apple.apps(); await apple.windows("TextEdit") // list_windows entries, titled
apple.app("TextEdit",{window:"b.txt"}) // or a window_id: observations, actions, menus and keys act on that window, never the app's focused one; a title matches exactly, else a unique part
app.observe({diffOnly?,maxElements?}) // get_app_state JSON, remembers the token
app.find({role?,label?,label_contains?,value_contains?,text?}) // find_elements JSON
app.click(target,{clickCount?,mouseButton?,modifiers?}); app.setValue(target,value); app.type(text); app.press(keys); app.selectText(target,text,{prefix?,suffix?,selection?}); app.secondaryAction(target,"AXShowMenu"); app.menu(["File","New Tab"]); app.scroll(target,direction,pages?) // modifiers refused
app.waitFor(target|{window_title},{gone?,timeoutMs?}); app.step({type:"click",...}) // any run_steps step
app.verify([{element_index,exists?,value?,label?}],{windowTitle?,timeoutMs?})
app.batch([apple.steps.click({label:"1"}),apple.steps.press("Return")],{pace?,expect?:{checks?,window_title?,timeout_ms?}}); app.chain(steps) // steps in ONE guarded call, stops at the first failure; apple.steps.* take the app methods' arguments. chain = pace "fast": known targets resolve against ONE read, only cheap guards run between steps, a target created mid-chain or a waitFor reads for itself, intermediate states are not read; default "verified" reads before every element step.
Scroll-until-found: click/setValue/selectText/secondaryAction with a query target accept {scrollWithin?,maxPages?,vision?,direction?} (or find:{scroll_within,...}): scrollWithin = element id or query (default largest scroll area), direction default down, maxPages 10 (max 50), vision "auto" (accessibility; OCR only where it exposes no text; needs Screen Recording)|"off"|"only". Clipped targets are scrolled into view, else paged in the background. Answer: found:{found_by,pages_scrolled,scrolled_into_view?,vision}; OCR-found text can only be clicked.
log(...values); await sleep(ms); JSON, Math, Date available.
Actions return the parsed result (status, changes, observation_token...); the latest token is reused. Acting by element id/coordinates needs an earlier observe()/find(); query targets, type, press, menu, waitFor observe themselves. A refusal or failed step throws ScriptActionError (message, kind, refused, payload), catchable; uncaught, the call errors with {error,kind,failedAction,payload,log,actions}. read_only=true makes every mutation throw before dispatch. timeout_ms (default 30000, max 120000) or cancelling stops further actions and terminates a script that never yields. Different apps overlap under background delivery (Promise.all); the same app runs in call order; attended delivery serializes all. Answers {ok,value,log,actions:[{n,app,kind,ms,status}],elapsedMs}; value must be JSON-serializable (cut at 20 KB). include_screenshot=true attaches the last window image.`;

class ScriptActionError extends Error {
	readonly kind: string;
	readonly payload: unknown;
	readonly refused: string | undefined;

	constructor(
		message: string,
		details: { readonly kind: string; readonly payload?: unknown; readonly refused?: string },
	) {
		super(message);
		this.name = "ScriptActionError";
		this.kind = details.kind;
		this.payload = details.payload;
		this.refused = details.refused;
	}
}

interface ActionRecord {
	readonly n: number;
	readonly app: string;
	readonly kind: string;
	readonly ms: number;
	readonly status: string;
}

interface RunOptions {
	/** Actions on different apps may overlap (background delivery); otherwise they share one queue. */
	readonly parallelApps: boolean;
	readonly readOnly: boolean;
	readonly includeScreenshot: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(source: unknown, key: string): unknown {
	return isRecord(source) ? source[key] : undefined;
}

function errorMessage(error: unknown): string {
	if (isRecord(error) && typeof error["message"] === "string") {
		const name = typeof error["name"] === "string" ? error["name"] : "Error";
		return error instanceof ScriptActionError ? error.message : `${name}: ${error["message"]}`;
	}
	return String(error);
}

function invalid(message: string): ScriptActionError {
	return new ScriptActionError(message, { kind: "invalid-argument", refused: "invalid-argument" });
}

function firstString(...values: readonly unknown[]): string | undefined {
	return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function parseResult(result: ToolResult): { readonly payload: unknown; readonly image: ToolContent | undefined } {
	let text: string | undefined;
	let image: ToolContent | undefined;
	for (const item of result.content) {
		if (item.type === "text") {
			text = item.text;
		} else {
			image = item;
		}
	}
	if (text === undefined) {
		return { payload: null, image };
	}
	try {
		const parsed: unknown = JSON.parse(text);
		return { payload: parsed, image };
	} catch {
		return { payload: text, image };
	}
}

function stepFailureReason(runSteps: unknown): string | undefined {
	const steps = pick(runSteps, "steps");
	if (!Array.isArray(steps)) {
		return undefined;
	}
	for (const step of steps) {
		if (pick(step, "status") === "failed" || pick(step, "status") === "skipped") {
			return firstString(pick(step, "reason"));
		}
	}
	return undefined;
}

function describeFailure(
	result: ToolResult,
	payload: unknown,
): { readonly message: string; readonly refused: string | undefined } | undefined {
	const refusedEffect = pick(payload, "effect") === "refused";
	const runSteps = pick(payload, "runSteps");
	const stopped = pick(runSteps, "stoppedEarly") === true;
	if (result.isError !== true && !refusedEffect && !stopped) {
		return undefined;
	}
	const reason = firstString(pick(payload, "reason"));
	const message =
		firstString(
			pick(payload, "message"),
			pick(payload, "error"),
			stepFailureReason(runSteps),
			typeof payload === "string" ? payload : undefined,
			reason,
		) ?? "the action did not complete";
	return { message, refused: result.isError === true || refusedEffect ? reason : undefined };
}

const QUERY_KEYS: readonly (readonly [string, string])[] = [
	["role", "role"],
	["label", "label"],
	["label_contains", "label_contains"],
	["labelContains", "label_contains"],
	["value_contains", "value_contains"],
	["valueContains", "value_contains"],
	["text", "text"],
];

/** The snake_case element-query fields found in a script-supplied object (camelCase accepted too). */
function queryFields(source: unknown): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const [from, to] of QUERY_KEYS) {
		const value = pick(source, from);
		if (typeof value === "string") {
			fields[to] = value;
		}
	}
	return fields;
}

function toElementQuery(fields: Record<string, string>): ElementQuery {
	const parsed = elementQuerySchema.safeParse(fields);
	if (!parsed.success) {
		throw invalid("a query needs at least one of role, label, label_contains, value_contains, or text");
	}
	const query = parsed.data;
	return {
		...(query.role === undefined ? {} : { role: query.role }),
		...(query.label === undefined ? {} : { label: query.label }),
		...(query.label_contains === undefined ? {} : { labelContains: query.label_contains }),
		...(query.value_contains === undefined ? {} : { valueContains: query.value_contains }),
		...(query.text === undefined ? {} : { text: query.text }),
	};
}

function mutates(step: RunStep): boolean {
	return step.type !== "wait_for";
}

/** Steps that act on ids or coordinates from a specific observation must not run on a silently refreshed one. */
function needsObservedIds(step: RunStep): boolean {
	switch (step.type) {
		case "wait_for":
		case "type_text":
		case "press_keys":
		case "invoke_menu":
		case "set_window_frame":
		case "clipboard_write":
			return false;
		default:
			return !("target" in step && step.target !== undefined) || typeof step.find?.scroll_within === "string";
	}
}

function checksFrom(checks: unknown): VerifyCheckRequest[] | undefined {
	if (checks === undefined) {
		return undefined;
	}
	if (!Array.isArray(checks)) {
		throw invalid("verify checks must be an array of {element_index, exists?, value?, label?}");
	}
	return checks.map((check: unknown): VerifyCheckRequest => {
		const index = pick(check, "element_index") ?? pick(check, "elementIndex");
		if (typeof index !== "number" && typeof index !== "string") {
			throw invalid("each verify check needs an element_index");
		}
		const exists = pick(check, "exists");
		const value = pick(check, "value");
		const label = pick(check, "label");
		return {
			element_index: String(index),
			...(typeof exists === "boolean" ? { exists } : {}),
			...(typeof value === "string" ? { value } : {}),
			...(typeof label === "string" ? { label } : {}),
		};
	});
}

function verifyRequestFrom(checks: unknown, options: unknown): VerifyRequest {
	const parsedChecks = checksFrom(checks);
	const windowTitle = firstString(pick(options, "windowTitle"), pick(options, "window_title"));
	const timeoutMs = pick(options, "timeoutMs") ?? pick(options, "timeout_ms");
	return {
		...(parsedChecks === undefined ? {} : { checks: parsedChecks }),
		...(windowTitle === undefined ? {} : { windowTitle }),
		...(typeof timeoutMs === "number"
			? { timeoutMs: Math.min(Math.max(1, Math.trunc(timeoutMs)), MAX_EXPECT_TIMEOUT_MS) }
			: {}),
	};
}

/** What one `apple.app(...)` handle acts on. */
interface AppTarget {
	readonly app: string;
	readonly window: WindowSelector | undefined;
	/** The id `window` resolved to; kept while that window stays open, even when its title changes. */
	windowId: number | undefined;
}

/** What an action's answer means for the run's tokens. */
interface ExecScope {
	/** The window the action's observation was bound to; undefined when it followed the app's focused window. */
	readonly windowId?: number | undefined;
	/** A listing that observes nothing leaves the app's live token alone. */
	readonly keepsTokens?: boolean;
}

function appTarget(app: string, options: unknown): AppTarget {
	if (options !== undefined && !isRecord(options)) {
		throw invalid('apple.app options are an object such as { window: "Report.txt" }');
	}
	const window = pick(options, "window");
	if (window === undefined) {
		return { app, window: undefined, windowId: undefined };
	}
	if (typeof window === "string" && window.trim() !== "") {
		return { app, window, windowId: undefined };
	}
	if (typeof window === "number" && Number.isSafeInteger(window) && window > 0) {
		return { app, window, windowId: window };
	}
	throw invalid("window is a window title (or a unique part of one) or a window_id from apple.windows()");
}

/** The window an observation made for this handle is bound to: undefined when it follows the focused window. */
function boundId(target: AppTarget): number | undefined {
	return target.window === undefined ? undefined : target.windowId;
}

/** A live token belongs to a handle when it was observed on the handle's own window (or both follow the focused one). */
function sameBinding(target: AppTarget, windowId: number | undefined): boolean {
	return target.window === undefined ? windowId === undefined : windowId !== undefined && windowId === target.windowId;
}

function describeTarget(target: AppTarget): string {
	return target.window === undefined ? target.app : `${target.app} window ${JSON.stringify(target.window)}`;
}

function windowOption(windowId: number | undefined): { readonly windowId?: number } {
	return windowId === undefined ? {} : { windowId };
}

/** One script run: owns the per-app tokens, serializes actions, and records what happened. */
class ScriptRun {
	readonly actions: ActionRecord[] = [];
	readonly logLines: string[] = [];
	logDropped = 0;
	lastImage: ToolContent | undefined;
	lastFailure: ActionRecord | undefined;
	private readonly tokens = new Map<string, { readonly token: string; readonly windowId: number | undefined }>();
	private readonly tails = new Map<string, Promise<unknown>>();
	private nextAction = 1;

	constructor(
		private readonly session: GuardedSession,
		private readonly driver: RunStepDriver,
		private readonly options: RunOptions,
		private readonly signal: AbortSignal,
	) {}

	log(text: string): void {
		if (this.logLines.length >= MAX_LOG_ENTRIES) {
			this.logDropped += 1;
			return;
		}
		this.logLines.push(text.slice(0, MAX_LOG_CHARS));
	}

	private stopped(): ScriptActionError {
		return new ScriptActionError("run_script was stopped; no further actions are dispatched", {
			kind: "aborted",
			refused: "aborted",
		});
	}

	/** One queue per app, so different apps overlap while one app's actions stay in order. */
	private queue<T>(app: string, work: () => Promise<T>): Promise<T> {
		const key = this.options.parallelApps ? app.toLowerCase() : "";
		const next = (this.tails.get(key) ?? Promise.resolve()).then(() => {
			if (this.signal.aborted) {
				throw this.stopped();
			}
			return work();
		});
		this.tails.set(
			key,
			next.then(
				() => undefined,
				() => undefined,
			),
		);
		return next;
	}

	private async exec(
		app: string,
		kind: string,
		call: () => Promise<ToolResult>,
		scope: ExecScope = {},
	): Promise<unknown> {
		if (this.signal.aborted) {
			throw this.stopped();
		}
		const key = app.toLowerCase();
		const n = this.nextAction++;
		const startedAt = Date.now();
		const record = (status: string): ActionRecord => {
			const entry = { n, app, kind, ms: Date.now() - startedAt, status };
			this.actions.push(entry);
			return entry;
		};
		let result: ToolResult;
		try {
			result = await call();
		} catch (error: unknown) {
			if (scope.keepsTokens !== true) {
				this.tokens.delete(key);
			}
			this.lastFailure = record("error");
			throw new ScriptActionError(errorMessage(error), { kind: "error" });
		}
		const { payload, image } = parseResult(result);
		if (scope.keepsTokens !== true) {
			const token = pick(payload, "observation_token");
			if (typeof token === "string") {
				this.tokens.set(key, { token, windowId: scope.windowId });
			} else {
				this.tokens.delete(key);
			}
		}
		if (this.options.includeScreenshot && image !== undefined) {
			this.lastImage = image;
		}
		const failure = describeFailure(result, payload);
		if (failure !== undefined) {
			this.lastFailure = record(failure.refused === undefined ? "failed" : `refused:${failure.refused}`);
			throw new ScriptActionError(failure.message, {
				kind: failure.refused === undefined ? "failed" : "refused",
				payload,
				...(failure.refused === undefined ? {} : { refused: failure.refused }),
			});
		}
		record(firstString(pick(payload, "effect")) ?? "ok");
		return payload;
	}

	private async tokenFor(target: AppTarget, needsIds: boolean): Promise<string> {
		const key = target.app.toLowerCase();
		const existing = this.tokens.get(key);
		if (existing !== undefined && sameBinding(target, existing.windowId)) {
			return existing.token;
		}
		if (needsIds) {
			throw new ScriptActionError(
				`no live observation of ${describeTarget(target)}: call observe() or find() before acting on an element id or coordinates`,
				{ kind: "refused", refused: "needs-observation" },
			);
		}
		const windowId = await this.windowIdFor(target);
		await this.exec(
			target.app,
			"observe",
			() =>
				this.session.observe({
					app: target.app,
					diffOnly: false,
					includeScreenshot: false,
					...windowOption(windowId),
				}),
			{ windowId },
		);
		const fresh = this.tokens.get(key);
		if (fresh === undefined) {
			throw new ScriptActionError(`observing ${describeTarget(target)} returned no observation token`, {
				kind: "refused",
				refused: "needs-observation",
			});
		}
		return fresh.token;
	}

	/**
	 * The window a bound handle acts on: the one it resolved to before, while that window is still open
	 * (its title may have changed since, as a document's does once edited), else the one window whose
	 * title is `window` exactly or, failing that, contains it in any case. No match, or several, is refused
	 * with the app's windows named. Undefined for a handle that follows the app's focused window.
	 */
	private async windowIdFor(target: AppTarget): Promise<number | undefined> {
		const selector = target.window;
		if (typeof selector !== "string") {
			return selector;
		}
		let windows: readonly TopLevelWindow[];
		try {
			windows = (await this.session.windowsOf(target.app)).windows;
		} catch (error: unknown) {
			throw this.refuseWindow(target, errorMessage(error), "app-not-running");
		}
		if (target.windowId !== undefined && windows.some((window) => window.id === target.windowId)) {
			return target.windowId;
		}
		const exact = windows.filter((window) => window.title === selector);
		const part = selector.toLowerCase();
		const matches = exact.length > 0 ? exact : windows.filter((window) => window.title.toLowerCase().includes(part));
		const [only, ...others] = matches;
		if (only !== undefined && others.length === 0) {
			target.windowId = only.id;
			return only.id;
		}
		const listed = windows.map((window) => `${window.id} ${JSON.stringify(window.title)}`).join(", ") || "none";
		throw this.refuseWindow(
			target,
			only === undefined
				? `no ${target.app} window title matches ${JSON.stringify(selector)}; its windows: ${listed}`
				: `${matches.length} ${target.app} windows match ${JSON.stringify(selector)}; name one exactly or by window_id. Its windows: ${listed}`,
			only === undefined ? "window-not-found" : "window-ambiguous",
		);
	}

	/** A window binding that cannot be resolved: recorded as a refused action, and nothing is dispatched. */
	private refuseWindow(target: AppTarget, message: string, refused: string): ScriptActionError {
		const entry = { n: this.nextAction++, app: target.app, kind: "window", ms: 0, status: `refused:${refused}` };
		this.actions.push(entry);
		this.lastFailure = entry;
		return new ScriptActionError(message, { kind: "refused", refused });
	}

	observe(target: AppTarget, options: unknown): Promise<unknown> {
		const maxElements = pick(options, "maxElements");
		return this.queue(target.app, async () => {
			const windowId = await this.windowIdFor(target);
			return await this.exec(
				target.app,
				"observe",
				() =>
					this.session.observe({
						app: target.app,
						diffOnly: pick(options, "diffOnly") === true,
						includeScreenshot: this.options.includeScreenshot,
						...(typeof maxElements === "number" ? { maxElements } : {}),
						...windowOption(windowId),
					}),
				{ windowId },
			);
		});
	}

	find(target: AppTarget, query: unknown, options: unknown): Promise<unknown> {
		const maxResults = pick(options, "maxResults");
		const maxElements = pick(options, "maxElements");
		return this.queue(target.app, async () => {
			const windowId = await this.windowIdFor(target);
			return await this.exec(
				target.app,
				"find",
				() =>
					this.session.findElements({
						app: target.app,
						query: toElementQuery(queryFields(query)),
						includeScreenshot: this.options.includeScreenshot,
						...(typeof maxResults === "number" ? { maxResults: Math.min(maxResults, MAX_FIND_RESULTS) } : {}),
						...(typeof maxElements === "number" ? { maxElements } : {}),
						...windowOption(windowId),
					}),
				{ windowId },
			);
		});
	}

	/** Every on-screen window, or `app`'s, as list_windows answers (titles filled in from the apps). */
	windows(app: unknown): Promise<unknown> {
		if (app !== undefined && (typeof app !== "string" || app === "")) {
			throw invalid("apple.windows takes an app name, or nothing for every app's windows");
		}
		const label = app ?? "*";
		return this.queue(label, async () => {
			const payload = await this.exec(
				label,
				"list_windows",
				() => this.session.listWindows(app === undefined ? {} : { app }),
				{ keepsTokens: true },
			);
			return pick(payload, "windows") ?? [];
		});
	}

	apps(): Promise<unknown> {
		return this.queue("*", () => this.exec("*", "list_apps", () => this.session.listApps()));
	}

	private parseStep(app: string, raw: StepObject): RunStep {
		const parsed = runStepSchema.safeParse(raw);
		if (!parsed.success) {
			throw invalid(
				`invalid step: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
			);
		}
		const step = parsed.data;
		if (mutates(step) && this.options.readOnly) {
			const entry = { n: this.nextAction++, app, kind: step.type, ms: 0, status: "refused:read-only" };
			this.actions.push(entry);
			this.lastFailure = entry;
			throw new ScriptActionError(`run_script is read_only: ${step.type} was not dispatched`, {
				kind: "refused",
				refused: "read-only",
			});
		}
		return step;
	}

	private async runParsed(
		target: AppTarget,
		kind: string,
		steps: readonly RunStep[],
		expectOptions: unknown,
		pace?: RunPace,
	): Promise<unknown> {
		const expectInput = pick(expectOptions, "expect");
		const expectation =
			expectInput === undefined ? undefined : verifyRequestFrom(pick(expectInput, "checks"), expectInput);
		const token = await this.tokenFor(target, steps.some(needsObservedIds));
		return await this.exec(
			target.app,
			kind,
			() =>
				this.session.runSteps(
					token,
					target.app,
					steps,
					expectation,
					this.driver,
					{ fullState: false, includeScreenshot: this.options.includeScreenshot, retainTree: true },
					{ signal: this.signal, ...(pace === undefined ? {} : { pace }) },
				),
			{ windowId: boundId(target) },
		);
	}

	step(target: AppTarget, raw: StepObject, expectOptions?: unknown): Promise<unknown> {
		return this.queue(target.app, async () => {
			const step = this.parseStep(target.app, raw);
			return await this.runParsed(target, step.type, [step], expectOptions);
		});
	}

	/**
	 * Several steps in one guarded call: one token, one preflight, one outcome read, stops at the first failure.
	 * With pace "fast" they dispatch back to back, guarded by cheap checks instead of a read before each step.
	 */
	batch(target: AppTarget, raws: unknown, options?: unknown, forcedPace?: RunPace): Promise<unknown> {
		return this.queue(target.app, async () => {
			const requested = pick(options, "pace");
			if (requested !== undefined && requested !== "fast" && requested !== "verified") {
				throw invalid('pace is "verified" or "fast"');
			}
			const pace: RunPace | undefined = forcedPace ?? requested;
			if (!Array.isArray(raws) || raws.length === 0 || raws.length > MAX_BATCH_STEPS) {
				throw invalid(`batch needs an array of 1 to ${MAX_BATCH_STEPS} step objects`);
			}
			const steps = raws.map((raw: unknown) => {
				if (!isRecord(raw)) {
					throw invalid("each batch entry is a step object such as apple.steps.click({label:'OK'})");
				}
				return this.parseStep(target.app, raw);
			});
			return await this.runParsed(target, "batch", steps, options, pace);
		});
	}

	verify(target: AppTarget, checks: unknown, options: unknown): Promise<unknown> {
		return this.queue(target.app, async () => {
			const request = verifyRequestFrom(checks, options);
			const token = await this.tokenFor(target, request.checks !== undefined && request.checks.length > 0);
			return await this.exec(target.app, "verify", () => this.session.verify(token, target.app, request), {
				windowId: boundId(target),
			});
		});
	}
}

type StepObject = Record<string, unknown>;

/** The compiled worker next to this module, else (running from TypeScript source) the source file. */
const WORKER_URL = ((): URL => {
	const compiled = new URL("./script-worker.js", import.meta.url);
	return existsSync(fileURLToPath(compiled)) ? compiled : new URL("./script-worker.ts", import.meta.url);
})();

/** A runaway script exhausts its own heap, not the server's. */
const WORKER_HEAP_MB = 256;

function spawnWorker(): Worker {
	const worker = new Worker(WORKER_URL, { stdout: true, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
	worker.unref();
	return worker;
}

/** One idle worker kept ready, so a run does not wait for a thread and module load; every run gets a fresh one. */
let spareWorker: Worker | undefined;

function warmWorker(): void {
	if (spareWorker !== undefined) {
		return;
	}
	const worker = spawnWorker();
	const discard = (): void => {
		if (spareWorker === worker) {
			spareWorker = undefined;
		}
	};
	worker.on("error", discard);
	worker.on("exit", discard);
	spareWorker = worker;
}

function takeWorker(): Worker {
	const worker = spareWorker ?? spawnWorker();
	spareWorker = undefined;
	return worker;
}

function callError(error: unknown): CallError {
	if (error instanceof ScriptActionError) {
		return {
			kind: error.kind,
			message: error.message,
			name: error.name,
			refused: error.refused,
			payload: error.payload,
		};
	}
	const name = isRecord(error) && typeof error["name"] === "string" ? error["name"] : "Error";
	const message = isRecord(error) && typeof error["message"] === "string" ? error["message"] : String(error);
	return { kind: "unexpected", message, name, refused: undefined, payload: undefined };
}

/** One worker call, performed through the guarded run exactly as an in-process script's call was. */
async function perform(
	run: ScriptRun,
	targets: Map<number, AppTarget>,
	call: Extract<WorkerMessage, { readonly type: "call" }>,
): Promise<unknown> {
	const handle = (spec: WorkerTarget | undefined): AppTarget => {
		if (spec === undefined) {
			throw invalid("this call needs an app handle");
		}
		const known = targets.get(spec.id);
		if (known !== undefined) {
			return known;
		}
		const created = appTarget(spec.app, spec.window === undefined ? undefined : { window: spec.window });
		targets.set(spec.id, created);
		return created;
	};
	const [first, second] = call.args;
	switch (call.method) {
		case "apps":
			return await run.apps();
		case "windows":
			return await run.windows(first);
		case "observe":
			return await run.observe(handle(call.target), first);
		case "find":
			return await run.find(handle(call.target), first, second);
		case "step":
			if (!isRecord(first)) {
				throw invalid("step needs a step object such as {type:'click', element_index:'9'}");
			}
			return await run.step(handle(call.target), first, second);
		case "batch":
			return await run.batch(handle(call.target), first, second);
		case "chain":
			return await run.batch(handle(call.target), first, second, "fast");
		case "verify":
			return await run.verify(handle(call.target), first, second);
	}
}

/**
 * Runs the script in a worker thread and answers its action calls. The abort signal (timeout or cancellation)
 * terminates the worker, so a script that never yields cannot stall this thread.
 */
function runInWorker(code: string, run: ScriptRun, signal: AbortSignal, timeoutMs: number): Promise<ScriptOutcome> {
	const worker = takeWorker();
	const targets = new Map<number, AppTarget>();
	return new Promise<ScriptOutcome>((resolve) => {
		let settled = false;
		const finish = (outcome: ScriptOutcome): void => {
			if (settled) {
				return;
			}
			settled = true;
			signal.removeEventListener("abort", onAbort);
			void worker.terminate();
			resolve(outcome);
		};
		const onAbort = (): void =>
			finish(
				signal.reason === "timeout"
					? {
							ok: false,
							kind: "timeout",
							error: `run_script timed out after ${timeoutMs} ms; no further actions were dispatched`,
						}
					: {
							ok: false,
							kind: "cancelled",
							error: "run_script was cancelled; no further actions were dispatched",
						},
			);
		const answer = async (call: Extract<WorkerMessage, { readonly type: "call" }>): Promise<void> => {
			let reply: HostMessage;
			try {
				reply = { type: "reply", id: call.id, ok: true, value: await perform(run, targets, call) };
			} catch (error: unknown) {
				reply = { type: "reply", id: call.id, ok: false, error: callError(error) };
			}
			if (!settled) {
				worker.postMessage(reply);
			}
		};
		worker.on("message", (message: WorkerMessage) => {
			if (settled) {
				return;
			}
			if (message.type === "log") {
				run.log(message.text);
			} else if (message.type === "done") {
				run.logDropped += message.logDropped;
				finish(message.outcome);
			} else {
				void answer(message);
			}
		});
		worker.on("error", (error: Error) => finish({ ok: false, kind: "script-error", error: errorMessage(error) }));
		worker.on("exit", () =>
			finish({ ok: false, kind: "script-error", error: "the run_script worker exited before the script finished" }),
		);
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		worker.postMessage({ type: "run", code } satisfies HostMessage);
	});
}

function jsonResult(body: Record<string, unknown>, isError: boolean, image: ToolContent | undefined): ToolResult {
	const content: ToolContent[] = [{ type: "text", text: JSON.stringify(body) }];
	if (image !== undefined) {
		content.push(image);
	}
	return isError ? { isError: true, content } : { content };
}

export function registerScriptTools(
	server: McpServer,
	session: GuardedSession,
	computer: GuardedComputerInterface,
): void {
	warmWorker();
	server.registerTool(
		"run_script",
		{
			description: RUN_SCRIPT_DESCRIPTION,
			inputSchema: runScriptSchema,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (input, extra) => {
			const startedAt = Date.now();
			const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
			const controller = new AbortController();
			const onRequestAbort = (): void => controller.abort("cancelled");
			if (extra.signal.aborted) {
				controller.abort("cancelled");
			} else {
				extra.signal.addEventListener("abort", onRequestAbort, { once: true });
			}
			const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
			const run = new ScriptRun(
				session,
				createRunStepDriver(computer),
				{
					parallelApps: computer.delivery === "background",
					readOnly: input.read_only === true,
					includeScreenshot: input.include_screenshot === true,
				},
				controller.signal,
			);
			try {
				const outcome = controller.signal.aborted
					? ({ ok: false, kind: "cancelled", error: "run_script was cancelled before it started" } as const)
					: await runInWorker(input.code, run, controller.signal, timeoutMs);
				const common = {
					log: run.logLines,
					...(run.logDropped === 0 ? {} : { logDropped: run.logDropped }),
					actions: run.actions,
					elapsedMs: Date.now() - startedAt,
				};
				const image = input.include_screenshot === true ? run.lastImage : undefined;
				if (outcome.ok) {
					return jsonResult(
						{
							ok: true,
							value: outcome.value,
							...(outcome.valueTruncated ? { valueTruncated: true } : {}),
							...common,
						},
						false,
						image,
					);
				}
				return jsonResult(
					{
						ok: false,
						kind: outcome.kind,
						error: outcome.error,
						...(run.lastFailure === undefined ? {} : { failedAction: run.lastFailure }),
						...(outcome.payload === undefined ? {} : { payload: outcome.payload }),
						...common,
					},
					true,
					image,
				);
			} finally {
				clearTimeout(timer);
				extra.signal.removeEventListener("abort", onRequestAbort);
				controller.abort("finished");
				warmWorker();
			}
		},
	);
}
