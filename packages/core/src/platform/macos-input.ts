import { setTimeout as sleep } from "node:timers/promises";
import { openWindows } from "get-windows";
import { VirtualPointer } from "../computer/virtual-pointer.js";
import type { DragOptions, KeyOptions, Point, ScrollOptions } from "../types/index.js";
import {
	type MouseButton,
	getCurrentCursorPosition,
	postKeyboardEvent,
	postMouseEvent,
	postScrollEvent,
	postUnicodeText,
} from "./macos-ffi/coregraphics.js";
import { NOOP_POINTER_OVERLAY, type PointerOverlay } from "./macos-ffi/cursor-overlay.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";
import { modifierFlags, virtualKeyCodeFor } from "./macos-keycodes.js";
import { selectVisibleTargetWindow } from "./macos-window-target.js";

const DEFAULT_DRAG_FRAME_MILLISECONDS = 16;
const MAX_DRAG_STEPS = 60;

export class MacOSInputController {
	private targetPid: number | undefined;
	private lastTargetWindow: SkyLightTargetWindow | undefined;
	private readonly targetWindowsByPid = new Map<number, SkyLightTargetWindow>();
	private readonly overlay: PointerOverlay;
	private readonly pointer: VirtualPointer;

	constructor(targetPid?: number, overlay: PointerOverlay = NOOP_POINTER_OVERLAY) {
		this.overlay = overlay;
		this.pointer = new VirtualPointer(readRealCursorPosition());
		this.setTarget(targetPid);
	}

	setTarget(pid?: number): void {
		if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) {
			throw new Error("target pid must be a positive integer");
		}
		this.targetPid = pid;
		this.lastTargetWindow = pid === undefined ? undefined : this.targetWindowsByPid.get(pid);
	}

	async rememberTargetWindow(pid: number): Promise<SkyLightTargetWindow | undefined> {
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error("target pid must be a positive integer");
		}
		const targetWindow = await this.visibleWindowForPid(pid);
		if (targetWindow !== undefined) {
			this.targetWindowsByPid.set(pid, targetWindow);
			if (this.targetPid === pid) {
				this.lastTargetWindow = targetWindow;
			}
		}
		return targetWindow;
	}

	async move(position: Point): Promise<void> {
		await this.postMouse("move", position, "left", undefined, await this.targetWindow(position));
		this.markPointer(position);
	}

	async click(position: Point, button: MouseButton = "left"): Promise<void> {
		const targetWindow = await this.targetWindow(position);
		this.requirePointerWindow(targetWindow);
		this.lastTargetWindow = targetWindow;
		if (this.targetPid === undefined) {
			await this.move(position);
		}
		await this.postMouse("down", position, button, 1, targetWindow);
		await this.postMouse("up", position, button, 1, targetWindow);
		this.markPointer(position);
	}

	async doubleClick(position: Point): Promise<void> {
		const targetWindow = await this.targetWindow(position);
		this.requirePointerWindow(targetWindow);
		this.lastTargetWindow = targetWindow;
		if (this.targetPid === undefined) {
			await this.move(position);
		}
		await this.postMouse("down", position, "left", 1, targetWindow);
		await this.postMouse("up", position, "left", 1, targetWindow);
		await this.postMouse("down", position, "left", 2, targetWindow);
		await this.postMouse("up", position, "left", 2, targetWindow);
		this.markPointer(position);
	}

	async typeText(text: string): Promise<void> {
		const targetWindow = await this.requireSessionWindow("keyboard");
		for (const segment of Array.from(text)) {
			postUnicodeText(segment, this.targetPid, targetWindow);
		}
	}

	async pressKey(key: string, options?: KeyOptions): Promise<void> {
		const keyCode = virtualKeyCodeFor(key);
		const flags = modifierFlags(options?.modifiers ?? []);
		const targetWindow = await this.requireSessionWindow("keyboard");
		postKeyboardEvent({
			keyCode,
			keyDown: true,
			flags,
			text: undefined,
			targetPid: this.targetPid,
			targetWindow,
		});
		postKeyboardEvent({
			keyCode,
			keyDown: false,
			flags,
			text: undefined,
			targetPid: this.targetPid,
			targetWindow,
		});
	}

	async scroll(options: ScrollOptions): Promise<void> {
		const amount = Math.trunc(options.amount);
		const targetWindow = await this.requireSessionWindow("scroll");
		switch (options.direction) {
			case "up":
				postScrollEvent({ deltaX: 0, deltaY: amount, targetPid: this.targetPid, targetWindow });
				return;
			case "down":
				postScrollEvent({ deltaX: 0, deltaY: -amount, targetPid: this.targetPid, targetWindow });
				return;
			case "left":
				postScrollEvent({ deltaX: -amount, deltaY: 0, targetPid: this.targetPid, targetWindow });
				return;
			case "right":
				postScrollEvent({ deltaX: amount, deltaY: 0, targetPid: this.targetPid, targetWindow });
				return;
		}
	}

	async drag(options: DragOptions): Promise<void> {
		const targetWindow = await this.targetWindow(options.from);
		this.requirePointerWindow(targetWindow);
		this.lastTargetWindow = targetWindow;
		if (this.targetPid === undefined) {
			await this.move(options.from);
		}
		await this.postMouse("down", options.from, "left", 1, targetWindow);

		const duration = options.duration ?? 0;
		const steps = dragSteps(duration);
		const delay = steps <= 1 ? 0 : duration / steps;
		for (let step = 1; step <= steps; step += 1) {
			const position = interpolatePoint(options.from, options.to, step / steps);
			await this.postMouse("drag", position, "left", 1, targetWindow);
			if (delay > 0 && step < steps) {
				await sleep(delay);
			}
		}

		await this.postMouse("up", options.to, "left", 1, targetWindow);
		this.markPointer(options.to);
	}

	getCursorPosition(): Point {
		return this.pointer.position();
	}

	close(): void {
		this.overlay.close();
	}

	private markPointer(position: Point): void {
		this.pointer.moveTo(position);
		this.overlay.set(position);
	}

	private async postMouse(
		kind: "move" | "down" | "up" | "drag",
		position: Point,
		button: MouseButton,
		clickState: number | undefined,
		targetWindow: SkyLightTargetWindow | undefined,
	): Promise<void> {
		postMouseEvent({ kind, position, button, clickState, targetPid: this.targetPid, targetWindow });
	}

	private async targetWindow(position: Point): Promise<SkyLightTargetWindow | undefined> {
		if (this.targetPid === undefined) {
			return undefined;
		}
		const targetWindow = await this.visibleWindowForPid(this.targetPid, position);
		if (targetWindow !== undefined) {
			this.targetWindowsByPid.set(this.targetPid, targetWindow);
		}
		return targetWindow;
	}

	private async visibleWindowForPid(pid: number, position?: Point): Promise<SkyLightTargetWindow | undefined> {
		const windows = await openWindows();
		return selectVisibleTargetWindow(windows, pid, position);
	}

	private requirePointerWindow(targetWindow: SkyLightTargetWindow | undefined): void {
		if (this.targetPid !== undefined && targetWindow === undefined) {
			throw new Error("targeted pointer input requires get_app_state or a visible target window");
		}
	}

	private async requireSessionWindow(action: "keyboard" | "scroll"): Promise<SkyLightTargetWindow | undefined> {
		if (this.targetPid === undefined) {
			return undefined;
		}
		if (this.lastTargetWindow !== undefined) {
			return this.lastTargetWindow;
		}
		const targetWindow = await this.visibleWindowForPid(this.targetPid);
		if (targetWindow === undefined) {
			throw new Error(
				`targeted ${action} input requires get_app_state, a visible target window, or a prior pointer action`,
			);
		}
		this.targetWindowsByPid.set(this.targetPid, targetWindow);
		this.lastTargetWindow = targetWindow;
		return this.lastTargetWindow;
	}
}

function readRealCursorPosition(): Point {
	try {
		const position = getCurrentCursorPosition();
		return { x: Math.round(position.x), y: Math.round(position.y) };
	} catch {
		return { x: 0, y: 0 };
	}
}

function dragSteps(duration: number): number {
	if (duration <= 0) {
		return 1;
	}
	return Math.max(1, Math.min(MAX_DRAG_STEPS, Math.ceil(duration / DEFAULT_DRAG_FRAME_MILLISECONDS)));
}

function interpolatePoint(from: Point, to: Point, progress: number): Point {
	return {
		x: Math.round(from.x + (to.x - from.x) * progress),
		y: Math.round(from.y + (to.y - from.y) * progress),
	};
}
