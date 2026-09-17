import type {
	AXTreeElement,
	AppState,
	AppStateOptions,
	ClipboardWriteInput,
	ClipboardWriteResult,
	ComputerCapabilities,
	DragOptions,
	GuardedComputerInterface,
	InputObservation,
	InvokeMenuResult,
	KeyOptions,
	Point,
	PreflightResult,
	ScreenshotOptions,
	ScreenshotResult,
	ScrollOptions,
	SelectTextOptions,
} from "@apple-cua/core";

export type Effect =
	| { readonly kind: "performAction"; readonly pid: number; readonly id: number; readonly action: string }
	| { readonly kind: "setValue"; readonly pid: number; readonly id: number; readonly value: string }
	| { readonly kind: "selectText"; readonly pid: number; readonly id: number }
	| { readonly kind: "click"; readonly point: Point }
	| { readonly kind: "drag"; readonly options: DragOptions }
	| { readonly kind: "type"; readonly text: string }
	| { readonly kind: "key"; readonly key: string }
	| { readonly kind: "invokeMenu"; readonly pid: number; readonly path: readonly string[] }
	| { readonly kind: "clipboardWrite"; readonly input: ClipboardWriteInput }
	| { readonly kind: "close" };

function diffElements(
	before: readonly AXTreeElement[],
	after: readonly AXTreeElement[],
): { added: AXTreeElement[]; removed: AXTreeElement[]; changed: { before: AXTreeElement; after: AXTreeElement }[] } {
	const beforeById = new Map(before.map((element) => [element.id, element] as const));
	const afterById = new Map(after.map((element) => [element.id, element] as const));
	const added = after.filter((element) => !beforeById.has(element.id));
	const removed = before.filter((element) => !afterById.has(element.id));
	const changed = after.flatMap((element) => {
		const previous = beforeById.get(element.id);
		return previous !== undefined && JSON.stringify(previous) !== JSON.stringify(element)
			? [{ before: previous, after: element }]
			: [];
	});
	return { added, removed, changed };
}

export class Deferred<T> {
	readonly promise: Promise<T>;
	private resolvePromise: ((value: T) => void) | undefined;

	constructor() {
		this.promise = new Promise<T>((resolve) => {
			this.resolvePromise = resolve;
		});
	}

	resolve(value: T): void {
		const resolve = this.resolvePromise;
		if (resolve === undefined) {
			throw new Error("deferred promise was already resolved");
		}
		this.resolvePromise = undefined;
		resolve(value);
	}
}

export class FakeGuardedComputer implements GuardedComputerInterface {
	readonly capabilities: ComputerCapabilities = {
		supportsScreenshot: true,
		supportsInput: true,
		supportsAccessibility: true,
		supportsClipboard: true,
	};
	readonly effects: Effect[] = [];
	readonly stateOptions: (AppStateOptions | undefined)[] = [];
	readonly preflightExpected: InputObservation[] = [];
	preflightResult: PreflightResult = { ok: true };
	preflightGate: Deferred<PreflightResult> | undefined;
	preflightEntered: Deferred<void> | undefined;
	stateGate: Deferred<void> | undefined;
	stateError: Error | undefined;
	inputError: Error | undefined;
	postActionSummary: AppState["axChangeSummary"] = { added: 1, removed: 0, changed: 0 };
	readonly hiddenElementIds = new Set<number>();
	readonly elementLabelOverrides = new Map<number, string>();
	readonly fieldValues = new Map<number, string | null>([
		[20, "draft"],
		[21, "queued"],
	]);
	valueWriteEffect: "apply" | "ignore" = "apply";
	/** Extra synthetic rows, used to model a mutation that changes many controls at once. */
	syntheticRowCount = 0;
	/** When true, state reports that the accessibility walk stopped at its element budget. */
	elementsTruncated = false;
	/** Delivery mode the fake computer reports, mirroring the native driver's default. */
	delivery: "attended" | "background" = "attended";
	windowId = 71;
	windowIdAfterAction: number | undefined;
	windowBounds = { x: 300, y: 150, width: 1000, height: 800 };
	private generation = 0;
	private readonly observations = new Map<number, InputObservation>();
	private actionDispatched = false;

	async getAppState(targetPid = 1234, options?: AppStateOptions): Promise<AppState> {
		this.stateOptions.push(options);
		const gate = this.stateGate;
		if (gate !== undefined) {
			this.stateGate = undefined;
			await gate.promise;
		}
		const error = this.stateError;
		if (error !== undefined) {
			this.stateError = undefined;
			this.observations.delete(targetPid);
			throw error;
		}
		const app = targetPid === 5678 ? "Other" : "Finder";
		const bundleId = targetPid === 5678 ? "com.example.other" : "com.apple.finder";
		const captureTree = options?.includeAccessibilityTree !== false;
		const elements = captureTree ? this.currentElements() : [];
		const previous = this.snapshotByPid.get(targetPid);
		const axChanges = previous === undefined || !captureTree ? undefined : diffElements(previous, elements);
		if (captureTree) {
			this.snapshotByPid.set(targetPid, elements);
		}
		const treeOmitted = options?.diffOnly === true && captureTree && this.sawSnapshot.has(targetPid);
		this.sawSnapshot.add(targetPid);
		const state: AppState = {
			app,
			bundleId,
			pid: targetPid,
			frontmost: true,
			axAvailable: true,
			elements: treeOmitted ? [] : elements,
			...(captureTree ? {} : { treeSkipped: true }),
			screenshotBase64: options?.includeScreenshot === false ? "" : Buffer.from("png-bytes").toString("base64"),
			screenshotWidth: 500,
			screenshotHeight: 400,
			screenshotMimeType: "image/png",
			display: { width: 1920, height: 1080, scaleFactor: 2 },
			windowBounds: { ...this.windowBounds },
			...(treeOmitted ? { treeOmitted: true } : {}),
			...(this.elementsTruncated ? { elementsTruncated: true } : {}),
			...(this.actionDispatched && this.postActionSummary !== undefined
				? {
						axChangeSummary: this.postActionSummary,
						...(axChanges === undefined ? {} : { axChanges }),
					}
				: {}),
		};
		if (captureTree) {
			this.generation += 1;
			this.observations.set(targetPid, {
				generation: this.generation,
				pid: targetPid,
				bundleId,
				windowId: this.windowId,
				windowBounds: { ...this.windowBounds },
				screenshotViewport: { width: 500, height: 400, bounds: { ...this.windowBounds } },
				observedElementIds: new Set(elements.map((element) => element.id)),
			});
		}
		return state;
	}

	assertObservationCurrent(): void {}

	getInputObservation(targetPid: number): InputObservation | undefined {
		return this.observations.get(targetPid);
	}

	async preflightInput(expected: InputObservation): Promise<PreflightResult> {
		this.preflightExpected.push(expected);
		const entered = this.preflightEntered;
		this.preflightEntered = undefined;
		entered?.resolve(undefined);
		const gate = this.preflightGate;
		this.preflightGate = undefined;
		return gate === undefined ? this.preflightResult : await gate.promise;
	}

	async listApps() {
		return [
			{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isRunning: true },
			{ name: "Other", bundleId: "com.example.other", pid: 5678, isRunning: true },
		];
	}

	async performAction(pid: number, id: number, action: string): Promise<void> {
		this.dispatch({ kind: "performAction", pid, id, action });
	}
	async setValue(pid: number, id: number, value: string): Promise<void> {
		this.dispatch({ kind: "setValue", pid, id, value });
		if (this.valueWriteEffect === "apply") {
			this.fieldValues.set(id, value);
		}
	}
	async selectText(pid: number, id: number, _options: SelectTextOptions): Promise<void> {
		this.dispatch({ kind: "selectText", pid, id });
	}
	async pressAtPosition(_pid: number, _position: Point): Promise<boolean> {
		return false;
	}
	async typeIntoFocused(_pid: number, _text: string): Promise<boolean> {
		return false;
	}
	async click(point: Point): Promise<void> {
		this.dispatch({ kind: "click", point });
	}
	async drag(options: DragOptions): Promise<void> {
		this.dispatch({ kind: "drag", options });
	}
	async type(text: string): Promise<void> {
		this.dispatch({ kind: "type", text });
	}
	async key(key: string, _options?: KeyOptions): Promise<void> {
		this.dispatch({ kind: "key", key });
	}
	async invokeMenu(pid: number, path: readonly string[]): Promise<InvokeMenuResult> {
		this.dispatch({ kind: "invokeMenu", pid, path });
		return { resolvedPath: path, action: "AXPress" };
	}

	writeClipboard(input: ClipboardWriteInput): ClipboardWriteResult {
		this.dispatch({ kind: "clipboardWrite", input });
		return { overwritten: true, writtenType: input.type, types: ["public.utf8-plain-text"] };
	}

	async close(): Promise<void> {
		this.effects.push({ kind: "close" });
	}

	setTarget(_pid?: number): void {}
	async screenshot(_options?: ScreenshotOptions): Promise<ScreenshotResult> {
		return { data: Buffer.from("png"), mimeType: "image/png", width: 1, height: 1 };
	}
	async move(_position: Point): Promise<void> {}
	async rightClick(point: Point): Promise<void> {
		this.dispatch({ kind: "click", point });
	}
	async middleClick(point: Point): Promise<void> {
		this.dispatch({ kind: "click", point });
	}
	async doubleClick(point: Point): Promise<void> {
		this.dispatch({ kind: "click", point });
	}
	async scroll(_options: ScrollOptions): Promise<void> {}
	async getCursorPosition(): Promise<Point> {
		return { x: 0, y: 0 };
	}
	async getScreenSize(): Promise<{ width: number; height: number }> {
		return { width: 1920, height: 1080 };
	}
	async getScreenshotViewport() {
		return undefined;
	}

	private readonly sawSnapshot = new Set<number>();
	private readonly snapshotByPid = new Map<number, AXTreeElement[]>();

	private currentElements(): AXTreeElement[] {
		const elements: AXTreeElement[] = [
			{
				id: 9,
				role: "AXButton",
				label: this.elementLabelOverrides.get(9) ?? "Open",
				value: null,
				frame: { x: 10, y: 20, width: 30, height: 40 },
				actions: ["AXPress"],
				children: [],
			},
			{
				id: 20,
				role: "AXTextField",
				label: this.elementLabelOverrides.get(20) ?? "Note",
				value: this.fieldValues.get(20) ?? null,
				frame: { x: 10, y: 70, width: 120, height: 24 },
				actions: ["AXSetValue"],
				children: [],
			},
			{
				id: 21,
				role: "AXTextField",
				label: this.elementLabelOverrides.get(21) ?? "Status",
				value: this.fieldValues.get(21) ?? null,
				frame: { x: 10, y: 100, width: 120, height: 24 },
				actions: ["AXSetValue"],
				children: [],
			},
		];
		for (let row = 0; row < this.syntheticRowCount; row += 1) {
			elements.push({
				id: 100 + row,
				role: "AXStaticText",
				label: `result row ${row} with a realistic descriptive label`,
				value: null,
				frame: { x: 0, y: row, width: 240, height: 18 },
				actions: [],
				children: [],
			});
		}
		return elements.filter((element) => !this.hiddenElementIds.has(element.id));
	}

	private dispatch(effect: Effect): void {
		const error = this.inputError;
		if (error !== undefined) {
			this.inputError = undefined;
			throw error;
		}
		this.actionDispatched = true;
		this.effects.push(effect);
		if (this.windowIdAfterAction !== undefined) {
			this.windowId = this.windowIdAfterAction;
		}
	}
}
