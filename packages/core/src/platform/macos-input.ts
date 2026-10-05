import { execFileSync } from "node:child_process";
import { assertScreenUnlocked } from "../computer/lock-guard.js";
import { VirtualPointer } from "../computer/virtual-pointer.js";
import type { DragOptions, InputDelivery, KeyModifierName, KeyOptions, Point, ScrollOptions } from "../types/index.js";
import { readRealCursorPosition } from "./macos-cursor.js";
import {
	focusedElementInWebArea,
	focusedWindowIdForPid,
	focusedWindowIsModal,
	focusedWindowShowsFilePanel,
	raiseWindowInApp,
	windowTitlesForPid,
} from "./macos-ffi/accessibility.js";
import {
	type MouseButton,
	postKeyboardEvent,
	postMouseEvent,
	postScrollEvent,
	postUnicodeText,
} from "./macos-ffi/coregraphics.js";
import { NOOP_POINTER_OVERLAY, type PointerOverlay } from "./macos-ffi/cursor-overlay.js";
import { filePanelServicePid } from "./macos-ffi/file-panel-service.js";
import { isScreenLocked } from "./macos-ffi/lock-screen.js";
import { type DisplaySleepAssertion, NOOP_DISPLAY_SLEEP } from "./macos-ffi/power.js";
import {
	type SkyLightTargetWindow,
	focusGuardFor,
	frontProcessSerialNumber,
	setProcessAppActive,
} from "./macos-ffi/skylight.js";
import { listOnscreenWindows } from "./macos-ffi/window-list.js";
import { startFocusStealWatch } from "./macos-focus-watch.js";
import { pointerModifierFlags, withHeldModifiers } from "./macos-input-modifiers.js";
import {
	type MousePost,
	postActivationPrimer,
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
import type { MacOSWindowInfo } from "./macos-window-target.js";
import { resolveTargetWindow } from "./macos-window-target.js";

/**
 * On-screen window ids in the WindowServer's front-to-back order. A window that is minimized or
 * on another space is absent, so using this list is what stops targeted input from being routed
 * to a window the caller cannot see.
 */
let onscreenWindowIdsSource: () => readonly number[] | undefined = () =>
	listOnscreenWindows()?.map((window) => window.id);

export function currentOnscreenWindowIds(): readonly number[] | undefined {
	return onscreenWindowIdsSource();
}

export function setOnscreenWindowIdsSourceForTesting(source: () => readonly number[] | undefined): void {
	onscreenWindowIdsSource = source;
}

/**
 * Keyboard events posted to a process go to its key window, not to the window they name, so with
 * two documents open the observed window has to be made the app's focused window first. Raising
 * inside the app does not activate it, which keeps background delivery background.
 */
let keyboardWindowFocuser: (pid: number, windowId: number) => Promise<void> = async (pid, windowId) => {
	const focusedId = focusedWindowIdForPid(pid);
	if (focusedId === windowId || focusedWindowIsModal(pid)) {
		return;
	}
	if (focusedId !== undefined) {
		// An untitled focused window is a helper of the target's own interaction (Finder's rename field
		// editor, a popover); raising the target over it would end that interaction. Only another
		// document window takes the keys away from the target. The WindowServer hides every title from a
		// process without Screen Recording, so accessibility names the window when the listing does not.
		const listedTitle = (await openWindowsForTargeting()).find((window) => window.id === focusedId)?.title;
		const focusedTitle = listedTitle || windowTitlesForPid(pid).get(focusedId);
		if (!focusedTitle || raiseWindowInApp(pid, windowId)) {
			return;
		}
	}
	// Off the physical console accessibility exposes no windows, but the menu bar still works and the
	// Window menu's entry for a document makes that window key. Only when another titled window of the
	// app is in front of the target: untitled helper windows (Finder's inline rename editor) belong to
	// the target's own interaction, and re-selecting the target would end it.
	const order = currentOnscreenWindowIds() ?? [];
	const depth = (id: number) => order.indexOf(id);
	const windows = (await openWindowsForTargeting()).filter(
		(window) => window.owner?.processId === pid && depth(window.id) >= 0,
	);
	const title = windows.find((window) => window.id === windowId)?.title;
	const coveredByDocument = windows.some(
		(window) => window.id !== windowId && Boolean(window.title) && depth(window.id) < depth(windowId),
	);
	if (!title || !coveredByDocument) {
		return;
	}
	try {
		// Loaded on use: the menu module binds accessibility calls this module otherwise never needs.
		const { invokeMenu } = await import("./macos-menu.js");
		await invokeMenu(pid, ["Window", title]);
	} catch {
		// No Window menu entry for it (or two windows share the title): keys go to the key window, as before.
	}
};

/**
 * Some apps activate themselves in response to background keys (Finder's Go to Folder panel), which
 * would pull the person out of the app they are using. Background delivery snapshots who was
 * frontmost before the input and, if the target app takes the front shortly after, sends it back
 * (polling every few milliseconds, off this thread; see macos-focus-watch.ts). A third app coming
 * forward is left alone.
 */
let focusStealWatcher: (window: SkyLightTargetWindow) => void = (window) => {
	const guard = focusGuardFor(window);
	if (guard !== null) {
		startFocusStealWatch(guard);
	}
};

/** The same focus guard for accessibility presses, which can activate an app just as keys can. */
export function guardAgainstFocusSteal(window: SkyLightTargetWindow): void {
	focusStealWatcher(window);
}

export function setFocusStealWatcherForTesting(watcher: (window: SkyLightTargetWindow) => void): void {
	focusStealWatcher = watcher;
}

/**
 * Keys for an open Save or Open panel go to the panel's service process, the only place they are
 * received; everything else goes to the app itself.
 */
let keyboardPidResolver: (pid: number) => number = (pid) =>
	focusedWindowShowsFilePanel(pid) ? (filePanelServicePid(pid) ?? pid) : pid;

/** The target app is not frontmost (so WebKit refuses the paste) and its focused element is in a web page. */
let backgroundPasteTarget: (pid: number, window: SkyLightTargetWindow) => boolean = (pid, window) =>
	focusGuardFor(window) !== null && focusedElementInWebArea(pid);
let clipboardText: () => string | undefined = () => {
	try {
		return execFileSync("pbpaste", [], { encoding: "utf8", timeout: 2000 });
	} catch {
		return undefined;
	}
};

export function setBackgroundPasteForTesting(
	target: (pid: number, window: SkyLightTargetWindow) => boolean,
	text: () => string | undefined,
): void {
	backgroundPasteTarget = target;
	clipboardText = text;
}

export function setKeyboardPidResolverForTesting(resolver: (pid: number) => number): void {
	keyboardPidResolver = resolver;
}

export function setKeyboardWindowFocuserForTesting(focuser: (pid: number, windowId: number) => Promise<void>): void {
	keyboardWindowFocuser = focuser;
}

/** Re-exported for callers that import the delivery mode beside the input controller. */
export type { InputDelivery };

// Inter-character delay for typeText. Posting keystrokes back-to-back outruns the
// target app's event loop and drops characters; ~12ms lets each be consumed.
const TYPE_CHARACTER_DELAY_MS = 12;

/** How long an app behind the person's that background input told it is active stays so without another action. */
export const BACKGROUND_ACTIVATION_IDLE_MILLISECONDS = 2_000;

export class MacOSInputController {
	private targetPid: number | undefined;
	private lastTargetWindow: SkyLightTargetWindow | undefined;
	private readonly targetWindowsByPid = new Map<number, SkyLightTargetWindow>();
	private readonly keyboardInputAt = new Map<number, number>();
	/** Apps behind the person's that this controller told they are active, by pid, to be told otherwise once idle. */
	private readonly activations = new Map<number, { readonly window: SkyLightTargetWindow; readonly psn: Buffer }>();
	private readonly activationReleaseTimers = new Map<number, NodeJS.Timeout>();
	/**
	 * Registered on process exit while any app is held: a process that ends (a server turns termination
	 * signals into an exit) still tells every app it told it is active otherwise, synchronously on the way out.
	 */
	private readonly releaseOnExit = (): void => {
		for (const pid of [...this.activations.keys()]) {
			this.releaseActivation(pid);
		}
	};
	private exitHookRegistered = false;
	private readonly overlay: PointerOverlay;
	private readonly pointer: VirtualPointer;
	private readonly isLocked: () => boolean;
	private readonly displaySleep: DisplaySleepAssertion;
	private gestureChain: Promise<void> = Promise.resolve();
	private readonly postMouse: MousePost = async (kind, position, button, clickState, targetWindow, flags) => {
		postMouseEvent({ kind, position, button, clickState, targetPid: this.targetPid, targetWindow, flags });
	};
	private readonly delivery: InputDelivery;

	constructor(
		targetPid?: number,
		overlay: PointerOverlay = NOOP_POINTER_OVERLAY,
		isLocked: () => boolean = isScreenLocked,
		displaySleep: DisplaySleepAssertion = NOOP_DISPLAY_SLEEP,
		delivery: InputDelivery = "attended",
	) {
		this.delivery = delivery;
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

	private get isBackground(): boolean {
		return this.delivery === "background";
	}

	/**
	 * Background delivery may only use routes that leave the user's session alone: no frontmost
	 * app change and no cursor movement. Anything that would need either is refused with the
	 * action named, because silently taking focus is how an unattended run interrupts the person
	 * using the machine.
	 */
	private requireBackgroundTarget(action: string): void {
		if (!this.isBackground) {
			return;
		}
		if (this.targetPid === undefined) {
			throw new Error(
				`background delivery cannot ${action} without a target app: global input would take over the cursor and focus`,
			);
		}
	}

	/**
	 * Hold modifier keys across one pointer gesture, to the same process and window the pointer events
	 * go to: flagsChanged key events before it, the flags handed to the gesture to stamp on every
	 * mouse or wheel event, and the keys released afterwards even when the gesture throws. Posting is
	 * per process under a target, so the person's own keyboard state is never touched.
	 *
	 * An app behind the person's swallows a click (the system spends it on activating the window, so a
	 * plain click selects nothing) and does not extend a selection on a command-click either, so in
	 * background delivery a click, double click or drag first has the target app told it is active (see
	 * activateBehind). Wheel events scroll a background app without that, so a scroll asks for it only
	 * when it carries modifiers.
	 */
	private async holdModifiers<T>(
		modifiers: ReadonlyArray<KeyModifierName> | undefined,
		targetWindow: SkyLightTargetWindow | undefined,
		activation: "pointer" | "wheel",
		gesture: (flags: number | undefined) => Promise<T>,
	): Promise<T> {
		// Read first: an unknown modifier name is refused here, before anything is posted.
		const modified = pointerModifierFlags(modifiers) !== 0;
		const pid = this.targetPid;
		let held = false;
		if (pid !== undefined && targetWindow !== undefined) {
			held =
				activation === "pointer" || modified
					? await this.activateBehind(pid, targetWindow)
					: this.postponeActivationRelease(pid);
		}
		try {
			return await this.postWithHeldModifiers(modifiers, targetWindow, gesture);
		} finally {
			if (held && pid !== undefined) {
				this.scheduleActivationRelease(pid);
			}
		}
	}

	/**
	 * Tell the app owning `window`, which sits behind the person's app, that it is active with `window` as
	 * its key window: no front-process change, no raise, nothing told to the person's app. An app that
	 * believes it is active takes the first click of a gesture instead of spending it on activating the
	 * window, reads modifier flags off a click, and enables its window commands (Save, New Folder). The
	 * first click after the activation is still spent on it, so a click outside every window absorbs it.
	 *
	 * The app stays told until no background action has reached it for
	 * {@link BACKGROUND_ACTIVATION_IDLE_MILLISECONDS} (or the controller closes): telling it otherwise
	 * right after each action leaves some apps (Finder) deaf to the very next activation, while a chain of
	 * actions shares one. An app held for another of its windows is told again, naming this one. True when
	 * this controller holds the app active afterwards; the caller then schedules the release.
	 */
	private async activateBehind(pid: number, window: SkyLightTargetWindow): Promise<boolean> {
		if (!this.isBackground) {
			return false;
		}
		this.cancelActivationRelease(pid);
		const held = this.activations.get(pid);
		if (held?.window.id === window.id) {
			return true;
		}
		const guard = focusGuardFor(window);
		if (guard === null || !setProcessAppActive(guard.targetPsn, window.id, true)) {
			// Frontmost already (there is nothing to tell it), or out of reach: an earlier hold stays as it was.
			return held !== undefined;
		}
		this.activations.set(pid, { window, psn: guard.targetPsn });
		this.syncExitHook();
		focusStealWatcher(window);
		await postActivationPrimer(this.mousePostFor(pid), window);
		return true;
	}

	/** Keep a held activation from running out while another action reaches the app; false when none is held. */
	private postponeActivationRelease(pid: number): boolean {
		if (!this.activations.has(pid)) {
			return false;
		}
		this.cancelActivationRelease(pid);
		return true;
	}

	private cancelActivationRelease(pid: number): void {
		const timer = this.activationReleaseTimers.get(pid);
		if (timer !== undefined) {
			clearTimeout(timer);
			this.activationReleaseTimers.delete(pid);
		}
	}

	private scheduleActivationRelease(pid: number): void {
		this.cancelActivationRelease(pid);
		const timer = setTimeout(() => {
			this.activationReleaseTimers.delete(pid);
			this.releaseActivation(pid);
		}, BACKGROUND_ACTIVATION_IDLE_MILLISECONDS);
		timer.unref();
		this.activationReleaseTimers.set(pid, timer);
	}

	/**
	 * Tell a held app it is no longer active, unless the person brought it forward meanwhile: then it
	 * really is the active app, and telling it otherwise would take that from them. Addressed by process,
	 * so it still lands after the window it was activated with has closed.
	 */
	private releaseActivation(pid: number): void {
		const held = this.activations.get(pid);
		if (held === undefined) {
			return;
		}
		this.activations.delete(pid);
		this.syncExitHook();
		if (frontProcessSerialNumber()?.equals(held.psn) !== true) {
			setProcessAppActive(held.psn, held.window.id, false);
		}
	}

	/** The exit hook is registered exactly while some app is held. */
	private syncExitHook(): void {
		const wanted = this.activations.size > 0;
		if (wanted && !this.exitHookRegistered) {
			process.on("exit", this.releaseOnExit);
		} else if (!wanted && this.exitHookRegistered) {
			process.off("exit", this.releaseOnExit);
		}
		this.exitHookRegistered = wanted;
	}

	/** Mouse events for `pid`, whichever app the controller is aimed at right now. */
	private mousePostFor(pid: number): MousePost {
		return async (kind, position, button, clickState, targetWindow, flags) => {
			postMouseEvent({ kind, position, button, clickState, targetPid: pid, targetWindow, flags });
		};
	}

	/**
	 * Run a window command (a menu item, a key equivalent) meant for `window` of app `pid`. A window command
	 * acts on the app's key window, so `window` is first made the app's focused window inside its own app.
	 * macOS validates window commands against their app being active, so under background delivery an app
	 * behind the person's is told it is active with `window` as its key window (see activateBehind) before
	 * `command` runs, when `wantsActivation()` says the command can use that (and always while this
	 * controller already holds the app); the person's own frontmost app is told nothing. `command` learns
	 * whether the app is held active; the hold lasts through it and ends once idle afterwards, like a
	 * pointer gesture's.
	 */
	async withWindowCommand<T>(
		pid: number,
		window: SkyLightTargetWindow,
		wantsActivation: () => boolean,
		command: (held: boolean) => Promise<T>,
	): Promise<T> {
		this.beforeInput();
		await keyboardWindowFocuser(pid, window.id);
		const activate = this.activations.has(pid) || (this.isBackground && wantsActivation());
		const held = activate ? await this.activateBehind(pid, window) : false;
		try {
			return await command(held);
		} finally {
			if (held) {
				this.scheduleActivationRelease(pid);
			}
		}
	}

	/** Whether this controller holds `pid` told it is active, so the app's own AXFrontmost is not the person's doing. */
	holdsActivation(pid: number): boolean {
		return this.activations.has(pid);
	}

	/** Keys reaching an app this controller holds active keep it so: its idle period restarts after them. */
	private async keepingActivation<T>(work: () => Promise<T>): Promise<T> {
		const pid = this.targetPid;
		const held = pid !== undefined && this.postponeActivationRelease(pid);
		try {
			return await work();
		} finally {
			if (held && pid !== undefined) {
				this.scheduleActivationRelease(pid);
			}
		}
	}

	private async postWithHeldModifiers<T>(
		modifiers: ReadonlyArray<KeyModifierName> | undefined,
		targetWindow: SkyLightTargetWindow | undefined,
		gesture: (flags: number | undefined) => Promise<T>,
	): Promise<T> {
		return await withHeldModifiers(
			modifiers,
			(keyCode, keyDown, flags) => {
				postKeyboardEvent({
					keyCode,
					keyDown,
					flags,
					text: undefined,
					targetPid: this.targetPid,
					targetWindow,
					flagsChanged: true,
				});
			},
			gesture,
		);
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

	async rememberTargetWindow(
		pid: number,
		windowId?: number,
		windows?: readonly MacOSWindowInfo[],
	): Promise<SkyLightTargetWindow | undefined> {
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error("target pid must be a positive integer");
		}
		const targetWindow =
			windowId === undefined
				? await this.visibleWindowForPid(pid, undefined, windows)
				: await this.windowByIdForPid(pid, windowId, windows);
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

	async click(
		position: Point,
		button: MouseButton = "left",
		modifiers?: ReadonlyArray<KeyModifierName>,
	): Promise<void> {
		await this.serialize(async () => {
			this.beforeInput();
			this.requireBackgroundTarget("click");
			const targetWindow = await this.targetWindow(position);
			this.requirePointerWindow(targetWindow);
			this.lastTargetWindow = targetWindow;
			await this.holdModifiers(modifiers, targetWindow, "pointer", async (flags) => {
				if (this.targetPid === undefined) {
					await this.move(position);
					await postClick(this.postMouse, position, button, 1, targetWindow, flags);
					this.markPointer(position);
				} else if (targetWindow !== undefined) {
					if (this.isBackground) {
						await postClick(this.postMouse, position, button, 1, targetWindow, flags);
						this.showPointer(position, true);
						return;
					}
					await runFocusLeasedClick(targetWindow, position, button, this.postMouse, flags);
					this.showPointer(position, true);
				}
			});
		});
	}

	async doubleClick(position: Point, modifiers?: ReadonlyArray<KeyModifierName>): Promise<void> {
		await this.serialize(async () => {
			this.beforeInput();
			this.requireBackgroundTarget("double click");
			const targetWindow = await this.targetWindow(position);
			this.requirePointerWindow(targetWindow);
			this.lastTargetWindow = targetWindow;
			await this.holdModifiers(modifiers, targetWindow, "pointer", async (flags) => {
				if (this.targetPid === undefined) {
					await this.move(position);
					await postDoubleClick(this.postMouse, position, targetWindow, flags);
					this.markPointer(position);
				} else if (targetWindow !== undefined) {
					if (this.isBackground) {
						await postDoubleClick(this.postMouse, position, targetWindow, flags);
						this.showPointer(position, true);
						return;
					}
					await runFocusLeasedDoubleClick(targetWindow, position, this.postMouse, flags);
					this.showPointer(position, true);
				}
			});
		});
	}

	async typeText(text: string): Promise<void> {
		await this.keepingActivation(() => this.postText(text));
	}

	private async postText(text: string): Promise<void> {
		this.beforeInput();
		const targetWindow = await this.requireSessionWindow("keyboard");
		const keyboardPid = this.keyboardPid();
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
			postUnicodeText(segment, keyboardPid, targetWindow);
			if (i < segments.length - 1) {
				await delayMilliseconds(TYPE_CHARACTER_DELAY_MS);
			}
		}
		this.noteKeyboardInput();
	}

	async pressKey(key: string, options?: KeyOptions): Promise<void> {
		await this.keepingActivation(() => this.postKey(key, options));
	}

	private async postKey(key: string, options?: KeyOptions): Promise<void> {
		this.beforeInput();
		if (await this.pasteAsTyping(key, options)) {
			return;
		}
		const keyCode = virtualKeyCodeFor(key);
		const flags = modifierFlags(options?.modifiers ?? []);
		const targetWindow = await this.requireSessionWindow("keyboard");
		const keyboardPid = this.keyboardPid();
		this.pingOverlay();
		postKeyboardEvent({
			keyCode,
			keyDown: true,
			flags,
			text: undefined,
			targetPid: keyboardPid,
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
			targetPid: keyboardPid,
			targetWindow,
		});
		this.noteKeyboardInput();
	}

	/**
	 * Aim keyboard input at the observed window without posting a key: an accessibility action that
	 * stands in for a key (Select All on the focused field) must act on that window's focused element,
	 * not on whichever window of the app happened to be focused.
	 */
	async prepareKeyboardTarget(): Promise<void> {
		this.beforeInput();
		await this.requireSessionWindow("keyboard");
	}

	/** The app keyboard and pointer input is currently aimed at, if any. */
	get currentTargetPid(): number | undefined {
		return this.targetPid;
	}

	/** When keys were last posted to an app, so an accessibility write can wait until they were handled. */
	lastKeyboardInputAt(pid: number): number | undefined {
		return this.keyboardInputAt.get(pid);
	}

	private noteKeyboardInput(): void {
		if (this.targetPid !== undefined) {
			this.keyboardInputAt.set(this.targetPid, performance.now());
		}
	}

	async scroll(options: ScrollOptions): Promise<void> {
		this.beforeInput();
		const amount = Math.max(0, Math.trunc(Math.abs(options.amount)));
		const targetWindow = await this.requireSessionWindow("scroll");
		this.overlay.setMode("scroll");
		this.pingOverlay();
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
		await this.holdModifiers(options.modifiers, targetWindow, "wheel", async (flags) => {
			for (let i = 0; i < steps; i++) {
				const d = Math.round(delta);
				postScrollEvent({
					deltaX: d * ux,
					deltaY: d * uy,
					targetPid: this.targetPid,
					targetWindow,
					flags,
					position: options.position,
				});
				if (i < steps - 1) {
					await delayMilliseconds(14);
				}
			}
		});
	}

	async drag(options: DragOptions): Promise<void> {
		await this.serialize(async () => {
			this.beforeInput();
			this.requireBackgroundTarget("drag");
			const targetWindow = await this.targetWindow(options.from);
			this.requirePointerWindow(targetWindow);
			this.lastTargetWindow = targetWindow;
			await this.holdModifiers(options.modifiers, targetWindow, "pointer", async (flags) => {
				if (this.targetPid === undefined) {
					await this.move(options.from);
					await postDragSequence(this.postMouse, options, targetWindow, flags);
					this.markPointer(options.to);
				} else if (targetWindow !== undefined) {
					if (this.isBackground) {
						this.showPointer(options.from, false);
						await postDragSequence(this.postMouse, options, targetWindow, flags);
						this.showPointer(options.to, false);
						return;
					}
					await runFocusLeasedDrag(targetWindow, options, this.postMouse, flags);
					this.markPointer(options.to);
				}
			});
		});
	}

	getCursorPosition(): Point {
		return this.pointer.position();
	}

	close(): void {
		for (const timer of this.activationReleaseTimers.values()) {
			clearTimeout(timer);
		}
		this.activationReleaseTimers.clear();
		for (const pid of [...this.activations.keys()]) {
			this.releaseActivation(pid);
		}
		this.displaySleep.release();
		this.overlay.close();
	}

	private markPointer(position: Point): void {
		this.pointer.moveTo(position);
		this.overlay.set(position);
	}

	/**
	 * Show where the agent is acting with the drawn overlay dot, and ripple it for a press. This only
	 * moves the overlay and the virtual pointer model, never the person's real cursor, so it is safe
	 * under background delivery; routes that act without any pointer (accessibility presses) use it
	 * too, so every action is visible to whoever is watching.
	 */
	showPointer(position: Point, press: boolean): void {
		this.overlay.setMode("pointer");
		this.markPointer(position);
		if (press) {
			this.overlay.setMode("click");
		}
	}

	showThinking(): void {
		this.overlay.setMode("thinking");
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

	private async visibleWindowForPid(
		pid: number,
		position?: Point,
		windows?: readonly MacOSWindowInfo[],
	): Promise<SkyLightTargetWindow | undefined> {
		const list = windows ?? (await openWindowsForTargeting());
		const resolution = resolveTargetWindow(list, pid, currentOnscreenWindowIds(), position);
		if (resolution.kind === "resolved") {
			return resolution.window;
		}
		return await selectSystemEventsTargetWindow(list, pid, position);
	}

	private async windowByIdForPid(
		pid: number,
		windowId: number,
		windows?: readonly MacOSWindowInfo[],
	): Promise<SkyLightTargetWindow | undefined> {
		const list = windows ?? (await openWindowsForTargeting());
		const resolution = resolveTargetWindow(list, pid, currentOnscreenWindowIds(), undefined, windowId);
		return resolution.kind === "resolved" ? resolution.window : undefined;
	}

	private requirePointerWindow(targetWindow: SkyLightTargetWindow | undefined): void {
		if (this.targetPid !== undefined && targetWindow === undefined) {
			throw new Error("targeted pointer input requires get_app_state or a visible target window");
		}
	}

	/**
	 * WebKit pastes only for the active app, so Cmd+V into a web page of an app in the background does
	 * nothing and Edit > Paste is disabled. Background delivery types the clipboard's plain text there
	 * instead: the same text lands and the person's app keeps focus. Anything else is a real key press.
	 */
	private async pasteAsTyping(key: string, options?: KeyOptions): Promise<boolean> {
		const modifiers = options?.modifiers ?? [];
		const isPaste =
			key.toLowerCase() === "v" && modifiers.length === 1 && ["cmd", "command"].includes(modifiers[0] ?? "");
		if (!isPaste || !this.isBackground || this.targetPid === undefined) {
			return false;
		}
		const targetWindow = await this.requireSessionWindow("keyboard");
		if (targetWindow === undefined || !backgroundPasteTarget(this.targetPid, targetWindow)) {
			return false;
		}
		const text = clipboardText();
		if (text === undefined || text.length === 0) {
			return false;
		}
		await this.typeText(text);
		return true;
	}

	private keyboardPid(): number | undefined {
		return this.targetPid === undefined ? undefined : keyboardPidResolver(this.targetPid);
	}

	private async requireSessionWindow(action: "keyboard" | "scroll"): Promise<SkyLightTargetWindow | undefined> {
		if (this.targetPid === undefined) {
			return undefined;
		}
		let targetWindow = this.lastTargetWindow;
		if (targetWindow === undefined) {
			targetWindow = await this.visibleWindowForPid(this.targetPid);
			if (targetWindow === undefined) {
				throw new Error(
					`targeted ${action} input requires get_app_state, a visible target window, or a prior pointer action`,
				);
			}
			this.targetWindowsByPid.set(this.targetPid, targetWindow);
			this.lastTargetWindow = targetWindow;
		}
		if (action === "keyboard") {
			if (this.isBackground) {
				focusStealWatcher(targetWindow);
			}
			await keyboardWindowFocuser(this.targetPid, targetWindow.id);
		}
		return targetWindow;
	}
}

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
