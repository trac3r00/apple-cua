import type {
	AppState,
	AppStateOptions,
	ComputerCapabilities,
	DragOptions,
	GuardedComputerInterface,
	InputObservation,
	KeyOptions,
	Point,
	PreflightResult,
	ScreenshotOptions,
	ScreenshotResult,
	ScrollOptions,
	SelectTextOptions,
} from "@macos-cua/core";

export type Effect =
	| { readonly kind: "performAction"; readonly pid: number; readonly id: number; readonly action: string }
	| { readonly kind: "setValue"; readonly pid: number; readonly id: number; readonly value: string }
	| { readonly kind: "selectText"; readonly pid: number; readonly id: number }
	| { readonly kind: "click"; readonly point: Point }
	| { readonly kind: "drag"; readonly options: DragOptions }
	| { readonly kind: "type"; readonly text: string }
	| { readonly kind: "key"; readonly key: string }
	| { readonly kind: "close" };

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
	windowId = 71;
	windowIdAfterAction: number | undefined;
	windowBounds = { x: 300, y: 150, width: 1000, height: 800 };
	private generation = 0;
	private observation: InputObservation | undefined;
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
			this.observation = undefined;
			throw error;
		}
		const app = targetPid === 5678 ? "Other" : "Finder";
		const bundleId = targetPid === 5678 ? "com.example.other" : "com.apple.finder";
		const state: AppState = {
			app,
			bundleId,
			pid: targetPid,
			frontmost: true,
			axAvailable: true,
			elements: [
				{
					id: 9,
					role: "AXButton",
					label: "Open",
					value: null,
					frame: { x: 10, y: 20, width: 30, height: 40 },
					actions: ["AXPress"],
					children: [],
				},
			],
			screenshotBase64: Buffer.from("png-bytes").toString("base64"),
			screenshotWidth: 500,
			screenshotHeight: 400,
			screenshotMimeType: "image/png",
			display: { width: 1920, height: 1080, scaleFactor: 2 },
			windowBounds: { ...this.windowBounds },
			...(this.actionDispatched && this.postActionSummary !== undefined
				? { axChangeSummary: this.postActionSummary }
				: {}),
		};
		this.generation += 1;
		this.observation = {
			generation: this.generation,
			pid: targetPid,
			bundleId,
			windowId: this.windowId,
			windowBounds: { ...this.windowBounds },
			screenshotViewport: { width: 500, height: 400, bounds: { ...this.windowBounds } },
			observedElementIds: new Set([9]),
		};
		return state;
	}

	getInputObservation(targetPid: number): InputObservation | undefined {
		return this.observation?.pid === targetPid ? this.observation : undefined;
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
