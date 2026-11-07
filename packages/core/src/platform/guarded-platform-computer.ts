import type { AppInfo, AppState } from "../accessibility/types.js";
import type {
	GuardedComputerInterface,
	InputObservation,
	PreflightOptions,
	PreflightResult,
} from "../computer/guarded-interface.js";
import { denyHostInteraction } from "../computer/host-interaction-policy.js";
import type { ComputerInterface, ScreenshotResult } from "../computer/interface.js";
import type { ScreenshotViewport } from "../computer/viewport.js";
import type { AppApprovalStore } from "../permission/app-approval.js";
import type {
	AppStateOptions,
	ComputerCapabilities,
	DragOptions,
	InputDelivery,
	KeyOptions,
	Point,
	PointerOptions,
	ScrollOptions,
	SelectTextOptions,
} from "../types/index.js";

/**
 * Adds the MCP server's observation guard to a backend that only implements ComputerInterface
 * (Windows UI Automation, Linux AT-SPI). Each observation replaces the previous one for its pid;
 * input prepared from a replaced observation, a window that changed, or an unapproved app is refused.
 */
export class GuardedPlatformComputer implements GuardedComputerInterface {
	private readonly observations = new Map<number, InputObservation>();
	private generation = 0;

	private readonly approval: AppApprovalStore | undefined;
	private readonly inputAllowed: boolean;

	constructor(
		private readonly inner: ComputerInterface,
		options: { readonly approval?: AppApprovalStore; readonly inputAllowed?: boolean } = {},
	) {
		this.approval = options.approval;
		this.inputAllowed = options.inputAllowed ?? false;
	}

	private assertInput(): void {
		if (!this.inputAllowed) denyHostInteraction("host-window");
	}

	get capabilities(): ComputerCapabilities {
		return this.inner.capabilities;
	}

	get delivery(): InputDelivery {
		return this.inner.delivery ?? "background";
	}

	getInputObservation(targetPid: number): InputObservation | undefined {
		return this.observations.get(targetPid);
	}

	async preflightInput(expected: InputObservation, options: PreflightOptions = {}): Promise<PreflightResult> {
		if (!this.inputAllowed) return { ok: false, reason: "isolated-session-required" };
		if (this.approval !== undefined && this.approval.decide(expected.bundleId) !== "approved") {
			return { ok: false, reason: "app-not-approved" };
		}
		const current = this.observations.get(expected.pid);
		if (current === undefined || current.generation !== expected.generation) {
			return { ok: false, reason: "observation-replaced" };
		}
		if (current.windowId !== expected.windowId) return { ok: false, reason: "window-changed" };
		const bounds = expected.windowBounds;
		const now = current.windowBounds;
		if (
			(options.requireSameBounds ?? true) &&
			(now.x !== bounds.x || now.y !== bounds.y || now.width !== bounds.width || now.height !== bounds.height)
		) {
			return { ok: false, reason: "window-bounds-changed" };
		}
		return { ok: true };
	}

	async getAppState(targetPid?: number, options?: AppStateOptions): Promise<AppState> {
		const state = await this.inner.getAppState(targetPid, options);
		if (this.approval !== undefined && this.approval.decide(state.bundleId) === "denied") {
			throw new Error(`App ${state.bundleId} is not approved by the host restriction.`);
		}
		const bounds = state.windowBounds ?? { x: 0, y: 0, width: state.screenshotWidth, height: state.screenshotHeight };
		this.generation += 1;
		this.observations.set(state.pid, {
			generation: this.generation,
			pid: state.pid,
			bundleId: state.bundleId,
			windowId: state.windowId ?? 0,
			windowBounds: bounds,
			screenshotViewport: { width: state.screenshotWidth, height: state.screenshotHeight, bounds },
			observedElementIds: new Set(state.elements.map((element) => element.id)),
		});
		return state;
	}

	screenshot(options?: Parameters<ComputerInterface["screenshot"]>[0]): Promise<ScreenshotResult> {
		return this.inner.screenshot(options);
	}
	setTarget(pid?: number): void {
		this.inner.setTarget(pid);
	}
	async move(position: Point): Promise<void> {
		this.assertInput();
		return this.inner.move(position);
	}
	async click(position: Point, options?: PointerOptions): Promise<void> {
		this.assertInput();
		return this.inner.click(position, options);
	}
	async rightClick(position: Point, options?: PointerOptions): Promise<void> {
		this.assertInput();
		return this.inner.rightClick(position, options);
	}
	async middleClick(position: Point, options?: PointerOptions): Promise<void> {
		this.assertInput();
		return this.inner.middleClick(position, options);
	}
	async doubleClick(position: Point, options?: PointerOptions): Promise<void> {
		this.assertInput();
		return this.inner.doubleClick(position, options);
	}
	async type(text: string): Promise<void> {
		this.assertInput();
		return this.inner.type(text);
	}
	async key(key: string, options?: KeyOptions): Promise<void> {
		this.assertInput();
		return this.inner.key(key, options);
	}
	async scroll(options: ScrollOptions): Promise<void> {
		this.assertInput();
		return this.inner.scroll(options);
	}
	async drag(options: DragOptions): Promise<void> {
		this.assertInput();
		return this.inner.drag(options);
	}
	getCursorPosition(): Promise<Point> {
		return this.inner.getCursorPosition();
	}
	getScreenSize(): Promise<{ width: number; height: number }> {
		return this.inner.getScreenSize();
	}
	assertObservationCurrent(targetPid: number, observationKey: string): void {
		this.inner.assertObservationCurrent(targetPid, observationKey);
	}
	getScreenshotViewport(targetPid: number): Promise<ScreenshotViewport | undefined> {
		return this.inner.getScreenshotViewport(targetPid);
	}
	listApps(): Promise<AppInfo[]> {
		return this.inner.listApps();
	}
	async setValue(targetPid: number, elementIndex: number, value: string): Promise<void> {
		this.assertInput();
		return this.inner.setValue(targetPid, elementIndex, value);
	}
	async selectText(targetPid: number, elementIndex: number, options: SelectTextOptions): Promise<void> {
		this.assertInput();
		return this.inner.selectText(targetPid, elementIndex, options);
	}
	async performAction(targetPid: number, elementIndex: number, action: string): Promise<void> {
		this.assertInput();
		return this.inner.performAction(targetPid, elementIndex, action);
	}
	async pressAtPosition(targetPid: number, position: Point): Promise<boolean> {
		this.assertInput();
		return this.inner.pressAtPosition(targetPid, position);
	}
	async typeIntoFocused(
		targetPid: number,
		text: string,
		options?: { readonly settleWrite?: boolean },
	): Promise<boolean> {
		this.assertInput();
		return this.inner.typeIntoFocused(targetPid, text, options);
	}
	close(): Promise<void> {
		return this.inner.close();
	}
}
