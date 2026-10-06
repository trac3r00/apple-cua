import { execFileSync } from "node:child_process";
import { type InputScope, assertInputMayContinue, currentInputScope } from "../computer/input-scope.js";
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
	windowIdsAtScreenPoint,
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
import { onlineDisplayBounds } from "./macos-ffi/display-list.js";
import { filePanelServicePid } from "./macos-ffi/file-panel-service.js";
import { isScreenLocked } from "./macos-ffi/lock-screen.js";
import { type DisplaySleepAssertion, NOOP_DISPLAY_SLEEP } from "./macos-ffi/power.js";
import {
	type SkyLightTargetWindow,
	focusGuardFor,
	frontProcessSerialNumber,
	setProcessAppActive,
} from "./macos-ffi/skylight.js";
import { listOnscreenWindows, listWindows } from "./macos-ffi/window-list.js";
import { startFocusStealWatch } from "./macos-focus-watch.js";
import { pointerModifierFlags, withHeldModifiers } from "./macos-input-modifiers.js";
import {
	type MousePost,
	type ScreenLayout,
	postActivationPrimer,
	postClick,
	postDoubleClick,
	postDragSequence,
	primerPosition,
	runFocusLeasedClick,
	runFocusLeasedDoubleClick,
	runFocusLeasedDrag,
} from "./macos-input-pointer.js";
import { modifierFlags, virtualKeyCodeFor } from "./macos-keycodes.js";
import { openWindowsForTargeting } from "./macos-open-windows.js";
import { selectSystemEventsTargetWindow } from "./macos-window-target-fallback.js";
import type { MacOSWindowInfo } from "./macos-window-target.js";
import { resolveTargetWindow, toTargetWindow, visibleWindowsForPid } from "./macos-window-target.js";

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

/**
 * The windows containing the element an app shows at a screen point, innermost first: how a pointer event bound to
 * an observed window tells a sheet of that window (which takes the event) from another window covering it.
 */
let pointWindowIds: (pid: number, position: Point) => readonly number[] | undefined = (pid, position) =>
	windowIdsAtScreenPoint(pid, position.x, position.y);

export function setPointWindowIdsForTesting(
	source: (pid: number, position: Point) => readonly number[] | undefined,
): void {
	pointWindowIds = source;
}

/**
 * Every display and on-screen window, read when an app is told it is active so that its activation primer lands clear
 * of all of them; undefined when either list cannot be read. Desktop elements (wallpaper, desktop icons) are left out
 * of the window list, and they lie on the displays, which are in it.
 */
let screenLayoutSource: () => ScreenLayout | undefined = () => {
	const displays = onlineDisplayBounds();
	const windows = listWindows()?.map((window) => window.bounds);
	return displays === undefined || windows === undefined ? undefined : { displays, windows };
};

export function setScreenLayoutSourceForTesting(source: () => ScreenLayout | undefined): void {
	screenLayoutSource = source;
}

/** Logged when an app was told it is active but no point is provably clear for its primer click. */
const PRIMER_SKIPPED_MESSAGE =
	"apple-cua: activation primer skipped: the display and window layout could not be read, so no point outside all of them is known; a first-mouse app (Finder) may spend the next background click on activating its window\n";

/**
 * Background activation (see MacOSInputController.activateBehind) is on unless APPLE_CUA_BACKGROUND_ACTIVATION turns it
 * off (off, 0, false, no).
 */
export function backgroundActivationEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
	const value = environment["APPLE_CUA_BACKGROUND_ACTIVATION"]?.trim().toLowerCase();
	return !(value === "off" || value === "0" || value === "false" || value === "no");
}

/** Re-exported for callers that import the delivery mode beside the input controller. */
export type { InputDelivery };

// Inter-character delay for typeText. Posting keystrokes back-to-back outruns the
// target app's event loop and drops characters; ~12ms lets each be consumed.
const TYPE_CHARACTER_DELAY_MS = 12;

/** How often a held key checks whether its call was stopped, so a long hold is released soon after a stop. */
const HOLD_CHECK_MILLISECONDS = 50;

/**
 * Whom one input call is for, and whether it may go on, fixed when the call starts (see beginCall) and handed down to
 * every event it posts. Nothing another call does changes it, so calls for different apps that overlap never post to
 * each other's app.
 */
interface InputCall {
	readonly pid: number | undefined;
	/** The observed window the call is bound to: its input reaches that window or is refused. */
	readonly windowId: number | undefined;
	readonly scope: InputScope | undefined;
}

/** How long an app behind the person's that background input told it is active stays so without another action. */
export const BACKGROUND_ACTIVATION_IDLE_MILLISECONDS = 2_000;

export class MacOSInputController {
	/** The app input goes to when no input scope names one: the constructor's, or setTarget's. */
	private defaultTargetPid: number | undefined;
	/** The window each app's input last went to (or its observation named), by pid. */
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
	private readonly delivery: InputDelivery;
	/** Whether background delivery may tell an app behind the person's that it is active (see activateBehind). */
	private readonly backgroundActivation: boolean;

	constructor(
		targetPid?: number,
		overlay: PointerOverlay = NOOP_POINTER_OVERLAY,
		isLocked: () => boolean = isScreenLocked,
		displaySleep: DisplaySleepAssertion = NOOP_DISPLAY_SLEEP,
		delivery: InputDelivery = "attended",
		backgroundActivation: boolean = backgroundActivationEnabled(),
	) {
		this.delivery = delivery;
		this.backgroundActivation = backgroundActivation;
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
	 * Start one input call: whom it is for is read here, once. The input scope of the calling async flow names the app
	 * (and the observed window) of the dispatch it belongs to; without a scope the default target applies. Background
	 * delivery may only use routes that leave the user's session alone, so a call with no target app at all is refused
	 * with the action named: untargeted events would take over the person's cursor and frontmost app.
	 */
	private beginCall(action: string): InputCall {
		const scope = currentInputScope();
		const pid = scope?.target?.pid ?? this.defaultTargetPid;
		if (this.isBackground && pid === undefined) {
			throw new Error(
				`background delivery cannot ${action} without a target app: global input would take over the cursor and focus`,
			);
		}
		const call: InputCall = { pid, windowId: scope?.target?.windowId, scope };
		this.checkpoint(call);
		return call;
	}

	/** Stops the call (InputInterrupted) once its scope says input must stop: the stop switch, a client cancel. */
	private checkpoint(call: InputCall): void {
		assertInputMayContinue(call.scope);
	}

	/**
	 * The last check before an event leaves. Under background delivery an event with no target app is never posted,
	 * whatever path led to it: it would go through the session-wide HID tap to the app in front of the person.
	 */
	private assertDeliverable(pid: number | undefined): void {
		if (pid === undefined && this.isBackground) {
			throw new Error(
				"background delivery refused an event with no target app: it would reach the app in front of the person",
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
		call: InputCall,
		modifiers: ReadonlyArray<KeyModifierName> | undefined,
		targetWindow: SkyLightTargetWindow | undefined,
		activation: "pointer" | "wheel",
		gesture: (flags: number | undefined) => Promise<T>,
	): Promise<T> {
		// Read first: an unknown modifier name is refused here, before anything is posted.
		const modified = pointerModifierFlags(modifiers) !== 0;
		const pid = call.pid;
		let held = false;
		if (pid !== undefined && targetWindow !== undefined) {
			held =
				activation === "pointer" || modified
					? await this.activateBehind(pid, targetWindow)
					: this.postponeActivationRelease(pid);
		}
		try {
			return await this.postWithHeldModifiers(call, modifiers, targetWindow, gesture);
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
	 * first click after the activation is still spent on it, so a primer click at a point inside no display and no
	 * window absorbs it; when no such point can be proven (the layout cannot be read) the primer is skipped and that is
	 * logged, and the gesture's first click may then be spent on the activation.
	 *
	 * The app stays told until no background action has reached it for
	 * {@link BACKGROUND_ACTIVATION_IDLE_MILLISECONDS} (or the controller closes): telling it otherwise
	 * right after each action leaves some apps (Finder) deaf to the very next activation, while a chain of
	 * actions shares one. An app held for another of its windows is told again, naming this one. True when
	 * this controller holds the app active afterwards; the caller then schedules the release. Never done with
	 * background activation turned off (APPLE_CUA_BACKGROUND_ACTIVATION=off), which avoids the release's autosave (see
	 * releaseActivation) at the cost of the clicks and window commands above.
	 */
	private async activateBehind(pid: number, window: SkyLightTargetWindow): Promise<boolean> {
		if (!this.isBackground || !this.backgroundActivation) {
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
		const primer = primerPosition(screenLayoutSource());
		if (primer === undefined) {
			process.stderr.write(PRIMER_SKIPPED_MESSAGE);
		} else {
			await postActivationPrimer(this.mousePostFor(pid), window, primer);
		}
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
	 *
	 * This is the deactivation event AppKit gets when a person switches away from the app, and the app reacts the same
	 * way: -[NSApplication _handleDeactivateEvent:] posts NSApplicationWillResignActiveNotification before anything else,
	 * and NSDocumentController autosaves every document of a class that autosaves in place (TextEdit, Preview, Pages),
	 * so another document of the app with unsaved changes is written to its file. No narrower release exists: the
	 * window named does not matter, the event autosaves even an app that is not active, and without it the app goes on
	 * believing it is active (AXFrontmost) behind the person's. Only not activating avoids it (backgroundActivation).
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
	private async keepingActivation<T>(call: InputCall, work: () => Promise<T>): Promise<T> {
		const pid = call.pid;
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
		call: InputCall,
		modifiers: ReadonlyArray<KeyModifierName> | undefined,
		targetWindow: SkyLightTargetWindow | undefined,
		gesture: (flags: number | undefined) => Promise<T>,
	): Promise<T> {
		return await withHeldModifiers(
			modifiers,
			(keyCode, keyDown, flags) => {
				this.assertDeliverable(call.pid);
				postKeyboardEvent({
					keyCode,
					keyDown,
					flags,
					text: undefined,
					targetPid: call.pid,
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

	/** The default target: where input goes when no input scope names an app (see beginCall). */
	setTarget(pid?: number): void {
		if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) {
			throw new Error("target pid must be a positive integer");
		}
		this.defaultTargetPid = pid;
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
		}
		return targetWindow;
	}

	async move(position: Point): Promise<void> {
		const call = this.beginCall("move the pointer");
		this.beforeInput();
		await this.postMove(call, position);
	}

	private async postMove(call: InputCall, position: Point): Promise<void> {
		await this.mousePost(call)("move", position, "left", undefined, await this.pointerWindow(call, position));
		this.markPointer(position);
	}

	async click(
		position: Point,
		button: MouseButton = "left",
		modifiers?: ReadonlyArray<KeyModifierName>,
	): Promise<void> {
		const call = this.beginCall("click");
		await this.serialize(async () => {
			this.beforeInput();
			const targetWindow = await this.pointerWindow(call, position);
			this.requirePointerWindow(call, targetWindow);
			// Read after waiting for the gesture before this one and for the window lookup: nothing goes down once stopped.
			this.checkpoint(call);
			const post = this.mousePost(call);
			await this.holdModifiers(call, modifiers, targetWindow, "pointer", async (flags) => {
				if (call.pid === undefined) {
					await this.postMove(call, position);
					await postClick(post, position, button, 1, targetWindow, flags);
					this.markPointer(position);
				} else if (targetWindow !== undefined) {
					if (this.isBackground) {
						await postClick(post, position, button, 1, targetWindow, flags);
						this.showPointer(position, true);
						return;
					}
					await runFocusLeasedClick(targetWindow, position, button, post, flags);
					this.showPointer(position, true);
				}
			});
		});
	}

	async doubleClick(position: Point, modifiers?: ReadonlyArray<KeyModifierName>): Promise<void> {
		const call = this.beginCall("double click");
		await this.serialize(async () => {
			this.beforeInput();
			const targetWindow = await this.pointerWindow(call, position);
			this.requirePointerWindow(call, targetWindow);
			this.checkpoint(call);
			const post = this.mousePost(call);
			await this.holdModifiers(call, modifiers, targetWindow, "pointer", async (flags) => {
				if (call.pid === undefined) {
					await this.postMove(call, position);
					await postDoubleClick(post, position, targetWindow, flags);
					this.markPointer(position);
				} else if (targetWindow !== undefined) {
					if (this.isBackground) {
						await postDoubleClick(post, position, targetWindow, flags);
						this.showPointer(position, true);
						return;
					}
					await runFocusLeasedDoubleClick(targetWindow, position, post, flags);
					this.showPointer(position, true);
				}
			});
		});
	}

	async typeText(text: string): Promise<void> {
		const call = this.beginCall("type");
		await this.keepingActivation(call, () => this.postText(call, text));
	}

	private async postText(call: InputCall, text: string): Promise<void> {
		this.beforeInput();
		const targetWindow = await this.requireSessionWindow(call, "keyboard");
		const keyboardPid = this.keyboardPid(call);
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
			// Read before every character, so a stop or a cancel ends a long text part-way rather than after it.
			this.checkpoint(call);
			this.assertDeliverable(keyboardPid);
			postUnicodeText(segment, keyboardPid, targetWindow);
			this.noteKeyboardInput(call);
			if (i < segments.length - 1) {
				await delayMilliseconds(TYPE_CHARACTER_DELAY_MS);
			}
		}
	}

	async pressKey(key: string, options?: KeyOptions): Promise<void> {
		const call = this.beginCall("press keys");
		await this.keepingActivation(call, () => this.postKey(call, key, options));
	}

	private async postKey(call: InputCall, key: string, options?: KeyOptions): Promise<void> {
		this.beforeInput();
		if (await this.pasteAsTyping(call, key, options)) {
			return;
		}
		const keyCode = virtualKeyCodeFor(key);
		const flags = modifierFlags(options?.modifiers ?? []);
		const targetWindow = await this.requireSessionWindow(call, "keyboard");
		const keyboardPid = this.keyboardPid(call);
		this.pingOverlay();
		this.checkpoint(call);
		this.assertDeliverable(keyboardPid);
		postKeyboardEvent({
			keyCode,
			keyDown: true,
			flags,
			text: undefined,
			targetPid: keyboardPid,
			targetWindow,
		});
		try {
			if (options?.holdMilliseconds !== undefined) {
				await this.holdKey(call, options.holdMilliseconds);
			}
		} finally {
			// The release goes out even when a stop cuts the hold short: a key left down keeps repeating.
			postKeyboardEvent({
				keyCode,
				keyDown: false,
				flags,
				text: undefined,
				targetPid: keyboardPid,
				targetWindow,
			});
			this.noteKeyboardInput(call);
		}
	}

	/** Wait out a key hold in short slices, ending it early (InputInterrupted) once the call is stopped. */
	private async holdKey(call: InputCall, milliseconds: number): Promise<void> {
		for (let left = milliseconds; left > 0; left -= HOLD_CHECK_MILLISECONDS) {
			await delayMilliseconds(Math.min(left, HOLD_CHECK_MILLISECONDS));
			this.checkpoint(call);
		}
	}

	/**
	 * Aim keyboard input at the observed window without posting a key: an accessibility action that
	 * stands in for a key (Select All on the focused field) must act on that window's focused element,
	 * not on whichever window of the app happened to be focused.
	 */
	async prepareKeyboardTarget(): Promise<void> {
		const call = this.beginCall("press keys");
		this.beforeInput();
		await this.requireSessionWindow(call, "keyboard");
	}

	/**
	 * The app keyboard and pointer input of the calling async flow is aimed at, if any: its input scope's target, else
	 * the default target.
	 */
	get currentTargetPid(): number | undefined {
		return currentInputScope()?.target?.pid ?? this.defaultTargetPid;
	}

	/** When keys were last posted to an app, so an accessibility write can wait until they were handled. */
	lastKeyboardInputAt(pid: number): number | undefined {
		return this.keyboardInputAt.get(pid);
	}

	private noteKeyboardInput(call: InputCall): void {
		if (call.pid !== undefined) {
			this.keyboardInputAt.set(call.pid, performance.now());
		}
	}

	async scroll(options: ScrollOptions): Promise<void> {
		const call = this.beginCall("scroll");
		this.beforeInput();
		const amount = Math.max(0, Math.trunc(Math.abs(options.amount)));
		const targetWindow = await this.requireSessionWindow(call, "scroll");
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
		await this.holdModifiers(call, options.modifiers, targetWindow, "wheel", async (flags) => {
			for (let i = 0; i < steps; i++) {
				this.checkpoint(call);
				this.assertDeliverable(call.pid);
				const d = Math.round(delta);
				postScrollEvent({
					deltaX: d * ux,
					deltaY: d * uy,
					targetPid: call.pid,
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
		const call = this.beginCall("drag");
		await this.serialize(async () => {
			this.beforeInput();
			const targetWindow = await this.pointerWindow(call, options.from);
			this.requirePointerWindow(call, targetWindow);
			this.checkpoint(call);
			const post = this.mousePost(call);
			// Read between drag steps; a stopped drag lets go of the button where it is and sends nothing more.
			const checkpoint = (): void => this.checkpoint(call);
			await this.holdModifiers(call, options.modifiers, targetWindow, "pointer", async (flags) => {
				if (call.pid === undefined) {
					await this.postMove(call, options.from);
					await postDragSequence(post, options, targetWindow, flags, checkpoint);
					this.markPointer(options.to);
				} else if (targetWindow !== undefined) {
					if (this.isBackground) {
						this.showPointer(options.from, false);
						await postDragSequence(post, options, targetWindow, flags, checkpoint);
						this.showPointer(options.to, false);
						return;
					}
					await runFocusLeasedDrag(targetWindow, options, post, flags, checkpoint);
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

	/** Mouse events of one call, addressed to its app; with no app they would take the HID tap (see assertDeliverable). */
	private mousePost(call: InputCall): MousePost {
		return async (kind, position, button, clickState, targetWindow, flags) => {
			this.assertDeliverable(call.pid);
			postMouseEvent({ kind, position, button, clickState, targetPid: call.pid, targetWindow, flags });
		};
	}

	/**
	 * The window a pointer event at `position` goes to. A call bound to an observed window addresses that window by its
	 * id, also where another window of the same app covers the point, because the coordinates came from that window's
	 * observation; only a sheet or popover of the observed window covering the point takes the event instead, since its
	 * controls are part of what was observed. A bound window that is no longer on screen, or a point outside it, refuses
	 * the input. An unbound call takes the app's window under the point.
	 */
	private async pointerWindow(call: InputCall, position: Point): Promise<SkyLightTargetWindow | undefined> {
		const pid = call.pid;
		if (pid === undefined) {
			return undefined;
		}
		if (call.windowId === undefined) {
			const targetWindow = await this.visibleWindowForPid(pid, position);
			if (targetWindow !== undefined) {
				this.targetWindowsByPid.set(pid, targetWindow);
			}
			return targetWindow;
		}
		const windows = await openWindowsForTargeting();
		const bound = await this.boundWindow(pid, call.windowId, "pointer", windows);
		if (!containsPoint(bound, position)) {
			throw new Error(
				`pointer input refused: (${Math.round(position.x)}, ${Math.round(position.y)}) is outside the observed window ${bound.id}; observe the app again`,
			);
		}
		const covering = frontmostWindowAt(windows, pid, position);
		const hosted =
			covering !== undefined &&
			covering.id !== bound.id &&
			isHostedBy(pointWindowIds(pid, position), covering.id, bound.id);
		const targetWindow = hosted ? covering : bound;
		this.targetWindowsByPid.set(pid, targetWindow);
		return targetWindow;
	}

	/** The observed window a call is bound to, as the WindowServer shows it now; refused when it is not on screen. */
	private async boundWindow(
		pid: number,
		windowId: number,
		action: "pointer" | "keyboard" | "scroll",
		windows?: readonly MacOSWindowInfo[],
	): Promise<SkyLightTargetWindow> {
		const targetWindow = await this.windowByIdForPid(pid, windowId, windows);
		if (targetWindow === undefined) {
			throw new Error(
				`${action} input refused: the observed window ${windowId} is no longer on screen for this app; observe the app again`,
			);
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

	private requirePointerWindow(call: InputCall, targetWindow: SkyLightTargetWindow | undefined): void {
		if (call.pid !== undefined && targetWindow === undefined) {
			throw new Error("targeted pointer input requires get_app_state or a visible target window");
		}
	}

	/**
	 * WebKit pastes only for the active app, so Cmd+V into a web page of an app in the background does
	 * nothing and Edit > Paste is disabled. Background delivery types the clipboard's plain text there
	 * instead: the same text lands and the person's app keeps focus. Anything else is a real key press.
	 */
	private async pasteAsTyping(call: InputCall, key: string, options?: KeyOptions): Promise<boolean> {
		const modifiers = options?.modifiers ?? [];
		const isPaste =
			key.toLowerCase() === "v" && modifiers.length === 1 && ["cmd", "command"].includes(modifiers[0] ?? "");
		if (!isPaste || !this.isBackground || call.pid === undefined) {
			return false;
		}
		const targetWindow = await this.requireSessionWindow(call, "keyboard");
		if (targetWindow === undefined || !backgroundPasteTarget(call.pid, targetWindow)) {
			return false;
		}
		const text = clipboardText();
		if (text === undefined || text.length === 0) {
			return false;
		}
		await this.postText(call, text);
		return true;
	}

	private keyboardPid(call: InputCall): number | undefined {
		return call.pid === undefined ? undefined : keyboardPidResolver(call.pid);
	}

	/**
	 * The window keyboard and wheel input of a call goes to: the observed window it is bound to (refused once that is
	 * off screen), else the window the app's input last went to, else its front window.
	 */
	private async requireSessionWindow(
		call: InputCall,
		action: "keyboard" | "scroll",
	): Promise<SkyLightTargetWindow | undefined> {
		const pid = call.pid;
		if (pid === undefined) {
			return undefined;
		}
		const targetWindow =
			call.windowId === undefined
				? (this.targetWindowsByPid.get(pid) ?? (await this.visibleWindowForPid(pid)))
				: await this.boundWindow(pid, call.windowId, action);
		if (targetWindow === undefined) {
			throw new Error(
				`targeted ${action} input requires get_app_state, a visible target window, or a prior pointer action`,
			);
		}
		this.targetWindowsByPid.set(pid, targetWindow);
		if (action === "keyboard") {
			if (this.isBackground) {
				focusStealWatcher(targetWindow);
			}
			await keyboardWindowFocuser(pid, targetWindow.id);
		}
		return targetWindow;
	}
}

function containsPoint(window: SkyLightTargetWindow, position: Point): boolean {
	const { x, y, width, height } = window.bounds;
	return position.x >= x && position.x <= x + width && position.y >= y && position.y <= y + height;
}

/** The app's frontmost on-screen window containing `position`, by the WindowServer's front-to-back order. */
function frontmostWindowAt(
	windows: readonly MacOSWindowInfo[],
	pid: number,
	position: Point,
): SkyLightTargetWindow | undefined {
	const order = currentOnscreenWindowIds();
	if (order === undefined) {
		return undefined;
	}
	const depth = new Map(order.map((id, index) => [id, index] as const));
	const front = visibleWindowsForPid(windows, pid)
		.map(toTargetWindow)
		.filter((window) => depth.has(window.id) && containsPoint(window, position))
		.sort((left, right) => (depth.get(left.id) ?? 0) - (depth.get(right.id) ?? 0))[0];
	return front;
}

/**
 * Whether the window covering a point is a sheet or popover of the observed window: the element the app shows there
 * lies in the covering window (innermost) and, further out, in the observed one.
 */
function isHostedBy(windowIds: readonly number[] | undefined, coveringId: number, boundId: number): boolean {
	return windowIds !== undefined && windowIds[0] === coveringId && windowIds.includes(boundId);
}

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
