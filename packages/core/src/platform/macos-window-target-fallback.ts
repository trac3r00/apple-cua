import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Point } from "../types/index.js";
import { execFileStdout } from "./exec-util.js";
import type { SkyLightTargetWindow } from "./macos-ffi/skylight.js";
import type { MacOSWindowInfo } from "./macos-window-target.js";

const execFileAsync = promisify(execFile);
const WINDOW_LOOKUP_TIMEOUT_MILLISECONDS = 1_000;
const BOUNDS_TOLERANCE = 2;

type WindowBounds = SkyLightTargetWindow["bounds"];

export async function selectSystemEventsTargetWindow(
	windows: readonly MacOSWindowInfo[],
	pid: number,
	position?: Point,
): Promise<SkyLightTargetWindow | undefined> {
	const boundsList = await systemEventsWindowBounds(pid);
	const matchedBounds =
		position === undefined
			? boundsList[0]
			: (boundsList.find((bounds) => containsPoint(bounds, position)) ?? boundsList[0]);
	if (matchedBounds === undefined) {
		return undefined;
	}
	const matchedWindow = windows.find((window) => isVisible(window) && boundsMatch(window.bounds, matchedBounds));
	if (matchedWindow === undefined) {
		return undefined;
	}
	return { id: matchedWindow.id, bounds: { ...matchedWindow.bounds } };
}

async function systemEventsWindowBounds(pid: number): Promise<readonly WindowBounds[]> {
	try {
		const result = await execFileAsync("osascript", ["-e", windowBoundsScript(pid)], {
			encoding: "utf8",
			timeout: WINDOW_LOOKUP_TIMEOUT_MILLISECONDS,
		});
		return parseBoundsRows(execFileStdout(result));
	} catch (error) {
		if (error instanceof Error) {
			return [];
		}
		throw error;
	}
}

function windowBoundsScript(pid: number): string {
	return `
tell application "System Events"
	set targetProcess to first process whose unix id is ${pid}
	set AppleScript's text item delimiters to linefeed
	set outRows to {}
	repeat with targetWindow in windows of targetProcess
		set windowPosition to position of targetWindow
		set windowSize to size of targetWindow
		set end of outRows to ((item 1 of windowPosition as text) & tab & (item 2 of windowPosition as text) & tab & (item 1 of windowSize as text) & tab & (item 2 of windowSize as text))
	end repeat
	return outRows as text
end tell
`;
}

function parseBoundsRows(stdout: string): readonly WindowBounds[] {
	return stdout
		.trim()
		.split("\n")
		.map((line) => line.split("\t").map((part) => Number.parseInt(part, 10)))
		.flatMap(([x, y, width, height]) =>
			x === undefined || y === undefined || width === undefined || height === undefined
				? []
				: [{ x, y, width, height }],
		);
}

function boundsMatch(windowBounds: WindowBounds, fallbackBounds: WindowBounds): boolean {
	return (
		Math.abs(windowBounds.x - fallbackBounds.x) <= BOUNDS_TOLERANCE &&
		Math.abs(windowBounds.y - fallbackBounds.y) <= BOUNDS_TOLERANCE &&
		Math.abs(windowBounds.width - fallbackBounds.width) <= BOUNDS_TOLERANCE &&
		Math.abs(windowBounds.height - fallbackBounds.height) <= BOUNDS_TOLERANCE
	);
}

function containsPoint(bounds: WindowBounds, position: Point): boolean {
	return (
		position.x >= bounds.x &&
		position.x <= bounds.x + bounds.width &&
		position.y >= bounds.y &&
		position.y <= bounds.y + bounds.height
	);
}

function isVisible(window: MacOSWindowInfo): boolean {
	return window.bounds.width > 0 && window.bounds.height > 0;
}
