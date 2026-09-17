import { openWindows } from "get-windows";
import type { ListedWindow } from "./macos-ffi/window-list.js";
import { listWindows } from "./macos-ffi/window-list.js";
import type { MacOSWindowInfo } from "./macos-window-target.js";

const OPEN_WINDOWS_ATTEMPTS = 3;
const OPEN_WINDOWS_RETRY_DELAY_MILLISECONDS = 30;
/** The helper binary gets a deadline because it can hang, not only fail, when macOS refuses it. */
const BINARY_LISTING_TIMEOUT_MILLISECONDS = 5_000;
/** App windows live at layer 0; menu bar items, Control Centre and drag helpers sit above them. */
const NORMAL_WINDOW_LAYER = 0;

export interface OpenWindowsSources {
	/** The in-process WindowServer listing; undefined means this build cannot read it. */
	readonly listNative: () => readonly MacOSWindowInfo[] | undefined;
	/** The helper-binary listing, kept for builds where the in-process binding cannot load. */
	readonly listBinary: () => Promise<readonly MacOSWindowInfo[]>;
}

/**
 * The app windows a caller can target, from a WindowServer listing: layer 0 only, because the
 * chrome above it is not something input should address.
 */
export function targetableWindows(listed: readonly ListedWindow[]): readonly MacOSWindowInfo[] {
	const windows: MacOSWindowInfo[] = [];
	for (const window of listed) {
		if (window.layer !== NORMAL_WINDOW_LAYER) {
			continue;
		}
		windows.push({
			id: window.id,
			bounds: window.bounds,
			owner: { processId: window.ownerPid, name: window.ownerName },
			title: window.title,
			layer: window.layer,
		});
	}
	return windows;
}

let nativeSourceOverride: (() => readonly MacOSWindowInfo[] | undefined) | undefined;

/**
 * Test seam in the shape of setOnscreenWindowIdsSourceForTesting: production reads the real
 * WindowServer listing, while a test pins which source answers so its fixtures stay authoritative
 * instead of the machine's actual windows.
 */
export function setOpenWindowsSourceForTesting(
	source: (() => readonly MacOSWindowInfo[] | undefined) | undefined,
): void {
	nativeSourceOverride = source;
}

function listNativeWindows(): readonly MacOSWindowInfo[] | undefined {
	const listed = listWindows();
	return listed === undefined ? undefined : targetableWindows(listed);
}

async function listBinaryWindows(): Promise<readonly MacOSWindowInfo[]> {
	return await withTimeout(
		openWindowsWithRetry(),
		BINARY_LISTING_TIMEOUT_MILLISECONDS,
		`the get-windows helper did not answer within ${BINARY_LISTING_TIMEOUT_MILLISECONDS} ms; it is a separate process macOS can refuse or kill, so grant Screen Recording to the app that runs this server, or run a build whose in-process window listing loads`,
	);
}

/**
 * On-screen windows for targeting. The in-process WindowServer listing comes first because it
 * asks from this process: under an app bundle it carries that bundle's own grants, while the
 * get-windows helper is a separate identity macOS can refuse — which is how a healthy
 * observation turns into a bare "Command failed" from the helper binary. The binary stays as the
 * fallback for builds where the in-process binding cannot load at all, and an unreadable listing
 * is reported as an error rather than as "nothing is on screen".
 */
export async function openWindowsForTargeting(
	sources: OpenWindowsSources = {
		listNative: nativeSourceOverride ?? listNativeWindows,
		listBinary: listBinaryWindows,
	},
): Promise<readonly MacOSWindowInfo[]> {
	const native = sources.listNative();
	if (native !== undefined) {
		return native;
	}
	return await sources.listBinary();
}

async function openWindowsWithRetry(): Promise<readonly MacOSWindowInfo[]> {
	let lastError: Error | undefined;
	for (let attempt = 1; attempt <= OPEN_WINDOWS_ATTEMPTS; attempt += 1) {
		try {
			return await openWindows();
		} catch (error) {
			if (!(error instanceof Error)) {
				throw error;
			}
			lastError = error;
			if (attempt < OPEN_WINDOWS_ATTEMPTS) {
				await delayMilliseconds(OPEN_WINDOWS_RETRY_DELAY_MILLISECONDS);
			}
		}
	}
	throw lastError ?? new Error("openWindows was not attempted");
}

async function withTimeout<TValue>(operation: Promise<TValue>, milliseconds: number, message: string): Promise<TValue> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(message)), milliseconds);
			}),
		]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
