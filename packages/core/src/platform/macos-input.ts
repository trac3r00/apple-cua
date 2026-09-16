import { assertScreenUnlocked } from "../computer/lock-guard.js";
import { VirtualPointer } from "../computer/virtual-pointer.js";
import type { DragOptions, KeyOptions, Point, ScrollOptions } from "../types/index.js";
import { readRealCursorPosition } from "./macos-cursor.js";
import {
	type MouseButton,
	postKeyboardEvent,
	postMouseEvent,
	postScrollEvent,
	postUnicodeText,
} from "./macos-ffi/coregraphics.js";
import { NOOP_POINTER_OVERLAY, type PointerOverlay } from "./macos-ffi/cursor-overlay.js";
import { isScreenLocked } from "./macos-ffi/lock-screen.js";
import { type DisplaySleepAssertion, NOOP_DISPLAY_SLEEP } from "./macos-ffi/power.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";
import {
	type MousePost,
	postClick,
	postDoubleClick,
	postDragSequence,
	runFocusLeasedClick,
	runFocusLeasedDoubleClick,
	runFocusLeasedDrag,
} from "./macos-input-pointer.js";
import { modifierFlags, virtualKeyCodeFor } from "./macos-keycodes.js";
import { openWindowsForTargeting } from "./macos-open-windows.js";
import { selectSystemEventsTargetWindow } from "./macos-window-target-fallback.js";
import { selectVisibleTargetWindow } from "./macos-window-target.js";

// Inter-character delay for typeText. Posting keystrokes back-to-back outruns the
// target app's event loop and drops characters; ~12ms lets each be consumed.
const TYPE_CHARACTER_DELAY_MS = 12;

export class MacOSInputController {
	private targetPid: number | undefined;
	private lastTargetWindow: SkyLightTargetWindow | undefined;
	private readonly targetWindowsByPid = new Map<number, SkyLightTargetWindow>();
	private readonly overlay: PointerOverlay;
	private readonly pointer: VirtualPointer;
	private readonly isLocked: () => boolean;
	private readonly displaySleep: DisplaySleepAssertion;
	private gestureChain: Promise<void> = Promise.resolve();
	private readonly postMouse: MousePost = async (kind, position, button, clickState, targetWindow) => {
		postMouseEvent({ kind, position, button, clickState, targetPid: this.targetPid, targetWindow });
	};

	constructor(
		targetPid?: number,
		overlay: PointerOverlay = NOOP_POINTER_OVERLAY,
		isLocked: () => boolean = isScreenLocked,
		displaySleep: DisplaySleepAssertion = NOOP_DISPLAY_SLEEP,
	) {
		this.overlay = overlay;
		this.isLocked = isLocked;
		this.displaySleep = displaySleep;
		this.pointer = new VirtualPointer(readRealCursorPosition());
		this.setTarget(targetPid);
	}

	private beforeInput(): void {
		assertScreenUnlocked(this.isLocked());
		this.displaySleep.acquire();
	}

	private serialize<T>(run: () => Promise<T>): Promise<T> {
		const result = this.gestureChain.then(run, run);
		this.gestureChain = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	setTarget(pid?: number): void {
		if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) {
			throw new Error("target pid must be a positive integer");
		}
		this.targetPid = pid;
		this.lastTargetWindow = pid === undefined ? undefined : this.targetWindowsByPid.get(pid);
	}

	async rememberTargetWindow(pid: number, windowId?: number): Promise<SkyLightTargetWindow | undefined> {
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error("target pid must be a positive integer");
		}
		const targetWindow =
			windowId === undefined ? await this.visibleWindowForPid(pid) : await this.windowByIdForPid(pid, windowId);
		if (targetWindow !== undefined) {
			this.targetWindowsByPid.set(pid, targetWindow);
			if (this.targetPid === pid) {
				this.lastTargetWindow = targetWindow;
			}
		}
		return targetWindow;
	}

	async move(position: Point): Promise<void> {
		this.beforeInput();
		await this.postMouse("move", position, "left", undefined, await this.targetWindow(position));
		this.markPointer(position);
	}

	async click(position: Point, button: MouseButton = "left"): Promise<void> {
		await this.serialize(async () => {
			this.beforeInput();
			const targetWindow = await this.targetWindow(position);
			this.requirePointerWindow(targetWindow);
			this.lastTargetWindow = targetWindow;
			if (this.targetPid === undefined) {
				await this.move(position);
				await postClick(this.postMouse, position, button, 1, targetWindow);
				this.markPointer(position);
			} else if (targetWindow !== undefined) {
				await runFocusLeasedClick(targetWindow, position, button, this.postMouse);
				this.markPointer(position);
			}
		});
	}

	async doubleClick(position: Point): Promise<void> {
		await this.serialize(async () => {
			this.beforeInput();
			const targetWindow = await this.targetWindow(position);
			this.requirePointerWindow(targetWindow);
			this.lastTargetWindow = targetWindow;
			if (this.targetPid === undefined) {
				await this.move(position);
				await postDoubleClick(this.postMouse, position, targetWindow);
				this.markPointer(position);
			} else if (targetWindow !== undefined) {
				await runFocusLeasedDoubleClick(targetWindow, position, this.postMouse);
				this.markPointer(position);
			}
		});
	}

	async typeText(text: string): Promise<void> {
		this.beforeInput();
		const targetWindow = await this.requireSessionWindow("keyboard");
		this.pingOverlay();
		// Pace keystrokes: posting characters back-to-back outruns the target app's
		// event processing and drops characters ("https://example.com" -> "https://e").
		// A small inter-character delay lets each keystroke be consumed before the next,
		// so a single delivery per char is reliable (no drops) without doubling.
		const segments = Array.from(text);
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			if (segment === undefined) {
				continue;
			}
			postUnicodeText(segment, this.targetPid, targetWindow);
			if (i < segments.length - 1) {
				await delayMilliseconds(TYPE_CHARACTER_DELAY_MS);
			}
		}
	}

	async pressKey(key: string, options?: KeyOptions): Promise<void> {
		this.beforeInput();
		const keyCode = virtualKeyCodeFor(key);
		const flags = modifierFlags(options?.modifiers ?? []);
		const targetWindow = await this.requireSessionWindow("keyboard");
		this.pingOverlay();
		postKeyboardEvent({
			keyCode,
			keyDown: true,
			flags,
			text: undefined,
			targetPid: this.targetPid,
			targetWindow,
		});
		if (options?.holdMilliseconds !== undefined) {
			await delayMilliseconds(options.holdMilliseconds);
		}
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
		this.beforeInput();
		const amount = Math.max(0, Math.trunc(Math.abs(options.amount)));
		const targetWindow = await this.requireSessionWindow("scroll");
		const unit: Record<ScrollOptions["direction"], [number, number]> = {
			up: [0, 1],
			down: [0, -1],
			left: [-1, 0],
			right: [1, 0],
		};
		const [ux, uy] = unit[options.direction];
		// Deliver the total in small steps so it GLIDES smoothly instead of jumping.
		const perStep = 4;
		const steps = Math.max(1, Math.ceil(amount / perStep));
		const delta = amount / steps;
		for (let i = 0; i < steps; i++) {
			const d = Math.round(delta);
			postScrollEvent({ deltaX: d * ux, deltaY: d * uy, targetPid: this.targetPid, targetWindow });
			if (i < steps - 1) {
				await delayMilliseconds(14);
			}
		}
	}

	async drag(options: DragOptions): Promise<void> {
		await this.serialize(async () => {
			this.beforeInput();
			const targetWindow = await this.targetWindow(options.from);
			this.requirePointerWindow(targetWindow);
			this.lastTargetWindow = targetWindow;
			if (this.targetPid === undefined) {
				await this.move(options.from);
				await postDragSequence(this.postMouse, options, targetWindow);
				this.markPointer(options.to);
			} else if (targetWindow !== undefined) {
				await runFocusLeasedDrag(targetWindow, options, this.postMouse);
				this.markPointer(options.to);
			}
		});
	}

	getCursorPosition(): Point {
		return this.pointer.position();
	}

	close(): void {
		this.displaySleep.release();
		this.overlay.close();
	}

	private markPointer(position: Point): void {
		this.pointer.moveTo(position);
		this.overlay.set(position);
	}

	// Keep the overlay cursor visible during keyboard-only actions (e.g. typing a
	// URL in browser.navigate, which never moves the mouse) by re-asserting it at
	// the last known pointer position. Also resets the daemon's idle timer.
	private pingOverlay(): void {
		this.overlay.set(this.pointer.position());
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
		const windows = await openWindowsForTargeting();
		return (
			selectVisibleTargetWindow(windows, pid, position) ??
			(await selectSystemEventsTargetWindow(windows, pid, position))
		);
	}

	private async windowByIdForPid(pid: number, windowId: number): Promise<SkyLightTargetWindow | undefined> {
		const windows = await openWindowsForTargeting();
		return selectVisibleTargetWindow(windows, pid, undefined, windowId);
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

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
