import { windowTitlesForPid } from "./macos-ffi/accessibility.js";
import { openWindowsForTargeting } from "./macos-open-windows.js";

export interface TopLevelWindow {
	readonly id: number;
	readonly ownerPid: number;
	readonly ownerName: string;
	readonly title: string;
	readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface TopLevelWindowOptions {
	/**
	 * Apps (by pid, or "all") whose untitled windows get their titles from the apps themselves over
	 * accessibility. The WindowServer hides every window title from a process without Screen Recording,
	 * while each app still names its own windows. It costs one accessibility request per app asked, so a
	 * caller that only compares window ids leaves it out.
	 */
	readonly titlesFor?: "all" | readonly number[];
}

/** A source of on-screen top-level windows, as the MCP session consumes it. */
export type WindowProbe = (options?: TopLevelWindowOptions) => Promise<readonly TopLevelWindow[]>;

/** On-screen top-level windows, for detecting side effects an action caused outside the observed window. */
export async function listTopLevelWindows(options: TopLevelWindowOptions = {}): Promise<readonly TopLevelWindow[]> {
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
	return options.titlesFor === undefined
		? summaries
		: fillWindowTitles(summaries, options.titlesFor, windowTitlesForPid);
}

/**
 * Give each untitled window of the apps asked for the title its app reports for it. Each app is asked
 * at most once; an app that cannot answer leaves its windows as they were.
 */
export function fillWindowTitles(
	windows: readonly TopLevelWindow[],
	titlesFor: "all" | readonly number[],
	titlesOfApp: (pid: number) => ReadonlyMap<number, string>,
): readonly TopLevelWindow[] {
	const wanted = titlesFor === "all" ? undefined : new Set(titlesFor);
	const answers = new Map<number, ReadonlyMap<number, string>>();
	return windows.map((window) => {
		if (window.title !== "" || (wanted !== undefined && !wanted.has(window.ownerPid))) {
			return window;
		}
		let titles = answers.get(window.ownerPid);
		if (titles === undefined) {
			try {
				titles = titlesOfApp(window.ownerPid);
			} catch {
				titles = new Map();
			}
			answers.set(window.ownerPid, titles);
		}
		const title = titles.get(window.id);
		return title === undefined || title === "" ? window : { ...window, title };
	});
}
