import { openWindows } from "get-windows";
import type { MacOSWindowInfo } from "./macos-window-target.js";

const OPEN_WINDOWS_ATTEMPTS = 3;
const OPEN_WINDOWS_RETRY_DELAY_MILLISECONDS = 30;

export async function openWindowsForTargeting(): Promise<readonly MacOSWindowInfo[]> {
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

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
