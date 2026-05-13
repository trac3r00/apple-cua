import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { activeWindow, openWindows } from "get-windows";
import type { WindowInfo, WindowInterface } from "./interface.js";

const execFileAsync = promisify(execFile);

type ActiveWindowResult = Awaited<ReturnType<typeof activeWindow>>;
type OpenWindowResult = Awaited<ReturnType<typeof openWindows>>[number];
type GetWindowResult = NonNullable<ActiveWindowResult> | OpenWindowResult;

export class MacOSWindows implements WindowInterface {
	async active(): Promise<WindowInfo | null> {
		const window = await activeWindow();
		return window ? mapWindow(window) : null;
	}

	async list(): Promise<readonly WindowInfo[]> {
		const windows = await withTimeout(openWindows(), 5_000, "openWindows");
		return windows.map(mapWindow);
	}

	async activate(bundleIdOrName: string): Promise<void> {
		await execFileAsync("osascript", [
			"-e",
			`tell application ${quoteAppleScriptString(bundleIdOrName)} to activate`,
		]);
	}
}

function mapWindow(window: GetWindowResult): WindowInfo {
	const owner = window.owner;
	return {
		bounds: {
			height: window.bounds.height,
			width: window.bounds.width,
			x: window.bounds.x,
			y: window.bounds.y,
		},
		...("bundleId" in owner ? { bundleId: owner.bundleId } : {}),
		id: window.id,
		processId: owner.processId,
		title: window.title,
		...("url" in window && window.url ? { url: window.url } : {}),
	};
}

function quoteAppleScriptString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`${label} timed out after ${ms}ms (likely missing Screen Recording permission)`));
		}, ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}
