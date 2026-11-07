import type { AXTreeElement, AppState, WindowInventoryEntry } from "../../accessibility/types.js";
import type { ComputerInterface, ScreenshotResult } from "../../computer/interface.js";
import { type ScreenshotViewport, screenRectToScreenshot } from "../../computer/viewport.js";
import type {
	AppStateOptions,
	DragOptions,
	KeyOptions,
	Point,
	PointerOptions,
	Rect,
	ScreenshotOptions,
	ScrollOptions,
	SelectTextOptions,
} from "../../types/index.js";
import {
	PowerShellTransport,
	type PowerShellTransportOptions,
	WindowsHostError,
	type WindowsTransport,
} from "./transport.js";
import * as wire from "./wire.js";

export { WindowsHostError } from "./transport.js";
export type { WindowsProcess, WindowsProcessFactory, WindowsTransport } from "./transport.js";

export interface WindowsHostComputerOptions extends PowerShellTransportOptions {
	readonly transport?: WindowsTransport;
}

interface Observation {
	readonly state: AppState;
	readonly generation: number;
	readonly frames: ReadonlyMap<number, Rect>;
	readonly refs: ReadonlyMap<number, number>;
}

/** UIA-only by default. Unsupported gestures fail rather than falling back to physical input. */
export class WindowsHostComputer implements ComputerInterface {
	readonly capabilities = {
		supportsScreenshot: true,
		supportsInput: true,
		supportsAccessibility: true,
		supportsClipboard: false,
	};
	readonly delivery: "attended" | "background";
	private readonly transport: WindowsTransport;
	private target: number | undefined;
	private logicalCursor: Point = { x: 0, y: 0 };
	private readonly observations = new Map<number, Observation>();
	private nextRef = 0;

	constructor(private readonly options: WindowsHostComputerOptions = {}) {
		this.transport = options.transport ?? new PowerShellTransport(options);
		this.delivery = options.physical === true ? "attended" : "background";
	}

	setTarget(pid?: number): void {
		this.target = pid;
	}

	private pid(pid = this.target): number {
		if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) {
			throw new WindowsHostError("TARGET_REQUIRED", "Set a target process id before input or capture");
		}
		return pid;
	}

	private observation(pid: number): Observation {
		const observation = this.observations.get(pid);
		if (!observation || observation.generation !== this.transport.generation || observation.state.treeSkipped) {
			throw new WindowsHostError("STALE_REF", "Observe the target app again");
		}
		return observation;
	}

	assertObservationCurrent(pid: number, key: string): void {
		if (this.observation(pid).state.observationKey !== key) {
			throw new WindowsHostError("STALE_REF", "Observation key expired; observe again");
		}
	}

	private async action(pid: number, ref: number, action: string, params: Record<string, unknown> = {}): Promise<void> {
		const observation = this.observation(pid);
		if (!observation.frames.has(ref)) throw new WindowsHostError("STALE_REF", "Unknown element ref");
		await this.transport.request("action", {
			...params,
			pid,
			ref: observation.refs.get(ref),
			action,
			snapshot: observation.state.observationKey,
		});
	}

	async getAppState(targetPid?: number, options: AppStateOptions = {}): Promise<AppState> {
		const pid = this.pid(targetPid);
		if (options.diffOnly || options.includeMenuBar || options.visibleOnly || options.settleMs !== undefined) {
			throw new WindowsHostError("UNSUPPORTED", "Windows snapshots do not support diff/menu/visible/settle options");
		}
		if (
			options.maxElements !== undefined &&
			(!Number.isSafeInteger(options.maxElements) || options.maxElements < 1)
		) {
			throw new WindowsHostError("INVALID_ARGUMENT", "maxElements must be a positive integer");
		}
		if (options.timeoutMs !== undefined) {
			throw new WindowsHostError("UNSUPPORTED", "Set timeoutMs on WindowsHostComputerOptions instead");
		}
		if (options.subtreeOf !== undefined && !this.observation(pid).refs.has(options.subtreeOf)) {
			throw new WindowsHostError("STALE_REF", "Unknown subtree ref; observe again");
		}
		try {
			const previous = this.observations.get(pid);
			const state = wire.state(
				await this.transport.request("snapshot", {
					pid,
					options: {
						...options,
						...(options.subtreeOf === undefined
							? {}
							: { subtreeOf: this.observation(pid).refs.get(options.subtreeOf) }),
					},
					windowId: options.windowId,
					previous: previous?.state.observationKey,
				}),
			);
			const clientRefs = new Map(state.elements.map((element) => [element.id, this.nextRef++]));
			if (clientRefs.size !== state.elements.length) {
				throw new WindowsHostError("PROTOCOL", "Duplicate element ids");
			}
			const refs = new Map<number, number>();
			state.elements = state.elements.map((element) => {
				const id = clientRefs.get(element.id);
				if (id === undefined) throw new WindowsHostError("PROTOCOL", "Missing element id");
				refs.set(id, element.id);
				return {
					...element,
					id,
					children: element.children.map((child) => {
						const ref = clientRefs.get(child);
						if (ref === undefined) throw new WindowsHostError("PROTOCOL", "Unknown child id");
						return ref;
					}),
				};
			});
			const frames = new Map(state.elements.map((element) => [element.id, element.frame]));
			const viewport = this.viewport(state);
			if (viewport) {
				state.elements = state.elements.map((element) => ({
					...element,
					frame: screenRectToScreenshot(element.frame, viewport),
				}));
			}
			if (!options.probe) {
				this.observations.set(pid, { state, frames, refs, generation: this.transport.generation });
			}
			return state;
		} catch (error) {
			if (!options.probe) this.observations.delete(pid);
			throw error;
		}
	}

	private viewport(state: AppState): ScreenshotViewport | undefined {
		if (!state.windowBounds) return undefined;
		return {
			windowBounds: state.windowBounds,
			screenshotWidth: state.screenshotWidth,
			screenshotHeight: state.screenshotHeight,
		};
	}

	async getScreenshotViewport(pid: number): Promise<ScreenshotViewport | undefined> {
		const observation = this.observations.get(pid);
		return observation ? this.viewport(observation.state) : undefined;
	}

	async listApps() {
		return wire.array(await this.transport.request("listApps")).map(wire.app);
	}

	async listAppIdentities() {
		return this.listApps();
	}

	async listWindows(pid?: number): Promise<WindowInventoryEntry[]> {
		return wire.array(await this.transport.request("listWindows", { pid })).map(wire.windowEntry);
	}

	async screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
		if (options.region || options.quality !== undefined) {
			throw new WindowsHostError("UNSUPPORTED", "Window capture does not support region or quality");
		}
		const pid = this.pid();
		const result = wire.record(
			await this.transport.request("screenshot", {
				...options,
				pid,
				windowId: this.observations.get(pid)?.state.windowId,
			}),
		);
		const mime = wire.string(result["mimeType"]);
		if (mime !== "image/png" && mime !== "image/jpeg") throw new WindowsHostError("PROTOCOL", "Invalid image type");
		return {
			data: Buffer.from(wire.string(result["data"]), "base64"),
			width: wire.number(result["width"]),
			height: wire.number(result["height"]),
			mimeType: mime,
		};
	}

	async move(position: Point): Promise<void> {
		if (this.options.physical) await this.physical("move", position);
		this.logicalCursor = { ...position };
	}

	private hit(pid: number, position: Point, action?: string): AXTreeElement | undefined {
		const observation = this.observation(pid);
		return [...observation.state.elements].reverse().find((element) => {
			const frame = observation.frames.get(element.id);
			return (
				frame !== undefined &&
				(!action ||
					(action === "press"
						? element.actions.some((name) => ["press", "toggle", "select", "expand"].includes(name))
						: element.actions.includes(action))) &&
				position.x >= frame.x &&
				position.y >= frame.y &&
				position.x < frame.x + frame.width &&
				position.y < frame.y + frame.height
			);
		});
	}

	private checkModifiers(options?: PointerOptions): void {
		if (options?.modifiers?.length) {
			throw new WindowsHostError("UNSUPPORTED", "Pointer modifiers are not supported; use explicit key input");
		}
	}

	async click(position: Point, options?: PointerOptions): Promise<void> {
		this.checkModifiers(options);
		const pid = this.pid();
		const element = this.hit(pid, position, "press");
		if (element) {
			await this.action(pid, element.id, "press");
		} else await this.physical("click", position);
	}

	async rightClick(position: Point, options?: PointerOptions): Promise<void> {
		this.checkModifiers(options);
		await this.physical("click", position, { button: "right" });
	}

	async middleClick(position: Point, options?: PointerOptions): Promise<void> {
		this.checkModifiers(options);
		await this.physical("click", position, { button: "middle" });
	}

	async doubleClick(position: Point, options?: PointerOptions): Promise<void> {
		this.checkModifiers(options);
		await this.physical("doubleClick", position);
	}

	async drag(options: DragOptions): Promise<void> {
		this.checkModifiers(options);
		if (options.waypoints?.length || options.duration !== undefined) {
			throw new WindowsHostError("UNSUPPORTED", "Timed drags and waypoints are not supported");
		}
		await this.physical("drag", options.from, { to: options.to, button: options.button });
	}

	private async physical(kind: string, position: Point, params: Record<string, unknown> = {}): Promise<void> {
		if (!this.options.physical) {
			throw new WindowsHostError("PHYSICAL_INPUT_REQUIRED", `${kind} requires explicit physical: true`);
		}
		await this.transport.request("physical", { ...params, kind, ...position });
	}

	async type(text: string): Promise<void> {
		await this.typeIntoFocused(this.pid(), text);
	}

	async typeIntoFocused(pid: number, text: string, _options?: { readonly settleWrite?: boolean }): Promise<boolean> {
		return wire.boolean(await this.transport.request("type", { pid: this.pid(pid), text }));
	}

	async key(key: string, options: KeyOptions = {}): Promise<void> {
		if (options.holdMilliseconds !== undefined) {
			throw new WindowsHostError("UNSUPPORTED", "Held keys are not supported");
		}
		await this.physical("key", this.logicalCursor, { key, modifiers: options.modifiers });
	}

	async scroll(options: ScrollOptions): Promise<void> {
		this.checkModifiers(options);
		if (!Number.isSafeInteger(options.amount) || options.amount < 0 || options.amount > 100) {
			throw new WindowsHostError("INVALID_ARGUMENT", "Scroll amount must be an integer from 0 to 100");
		}
		const pid = this.pid();
		const element = options.position
			? this.hit(pid, options.position, "scroll")
			: this.observation(pid).state.elements.find((element) => element.actions.includes("scroll"));
		if (!element) throw new WindowsHostError("UNSUPPORTED", "No observed ScrollPattern element");
		await this.action(pid, element.id, "scroll", { direction: options.direction, amount: options.amount });
	}

	async getCursorPosition(): Promise<Point> {
		return this.options.physical ? wire.point(await this.transport.request("cursor")) : { ...this.logicalCursor };
	}

	async getScreenSize(): Promise<{ width: number; height: number }> {
		const result = wire.record(await this.transport.request("screen"));
		return { width: wire.number(result["width"]), height: wire.number(result["height"]) };
	}

	async setValue(pid: number, ref: number, value: string): Promise<void> {
		await this.action(pid, ref, "setValue", { value });
	}

	async selectText(pid: number, ref: number, options: SelectTextOptions): Promise<void> {
		if (options.prefix !== undefined || options.suffix !== undefined) {
			throw new WindowsHostError("UNSUPPORTED", "Text prefix/suffix disambiguation is not supported");
		}
		await this.action(pid, ref, "selectText", { ...options });
	}

	async performAction(pid: number, ref: number, action: string): Promise<void> {
		await this.action(pid, ref, action === "AXPress" ? "press" : action);
	}

	async pressAtPosition(pid: number, position: Point): Promise<boolean> {
		const element = this.hit(pid, position, "press");
		if (!element) return false;
		await this.action(pid, element.id, "press");
		return true;
	}

	async elementFrame(pid: number, ref: number): Promise<Rect | undefined> {
		return this.observation(pid).frames.get(ref);
	}

	async close(): Promise<void> {
		this.observations.clear();
		await this.transport.close();
	}
}

export function createWindowsHostComputer(options: WindowsHostComputerOptions = {}): WindowsHostComputer {
	return new WindowsHostComputer(options);
}
