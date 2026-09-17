import { openWindowsForTargeting } from "./macos-open-windows.js";

export interface TopLevelWindow {
	readonly id: number;
	readonly ownerPid: number;
	readonly ownerName: string;
	readonly title: string;
	readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** On-screen top-level windows, for detecting side effects an action caused outside the observed window. */
export async function listTopLevelWindows(): Promise<readonly TopLevelWindow[]> {
	const windows = await openWindowsForTargeting();
	const summaries: TopLevelWindow[] = [];
	for (const window of windows) {
		const ownerPid = window.owner?.processId;
		if (ownerPid === undefined) {
			continue;
		}
		summaries.push({
			id: window.id,
			ownerPid,
			ownerName: window.owner?.name ?? "",
			title: window.title ?? "",
			bounds: {
				x: Math.round(window.bounds.x),
				y: Math.round(window.bounds.y),
				width: Math.round(window.bounds.width),
				height: Math.round(window.bounds.height),
			},
		});
	}
	return summaries;
}
