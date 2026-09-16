import { describe, expect, it } from "vitest";

import { resolveTargetWindow, toTargetWindow, visibleWindowsForPid } from "./macos-window-target.js";
import type { MacOSWindowInfo } from "./macos-window-target.js";

function window(
	id: number,
	pid: number,
	bounds: { x: number; y: number; width: number; height: number },
): MacOSWindowInfo {
	return { id, owner: { processId: pid }, bounds } as unknown as MacOSWindowInfo;
}

const first = window(100, 1234, { x: 0, y: 0, width: 800, height: 600 });
const second = window(200, 1234, { x: 900, y: 0, width: 800, height: 600 });
const bothOnscreen = [100, 200];

describe("#given an app with several windows #when an observed window id is named #then that exact window is resolved", () => {
	it("resolves by id regardless of window order", () => {
		expect(resolveTargetWindow([first, second], 1234, bothOnscreen, undefined, 200)).toEqual({
			kind: "resolved",
			window: toTargetWindow(second),
		});
		expect(resolveTargetWindow([second, first], 1234, bothOnscreen, undefined, 100)).toEqual({
			kind: "resolved",
			window: toTargetWindow(first),
		});
	});

	it("refuses a named window that is gone instead of retargeting another window", () => {
		const resolution = resolveTargetWindow([first], 1234, [100], undefined, 999);

		expect(resolution.kind).toBe("unavailable");
		expect(resolution.kind === "unavailable" ? resolution.reason : "").toMatch(/no longer open/);
	});

	it("refuses a named window that belongs to a different app", () => {
		const other = window(300, 5678, { x: 0, y: 0, width: 10, height: 10 });

		expect(resolveTargetWindow([other], 1234, [300], undefined, 300).kind).toBe("unavailable");
	});

	it("refuses a named window the WindowServer does not report on screen", () => {
		const minimized = resolveTargetWindow([first, second], 1234, [100], undefined, 200);

		expect(minimized.kind).toBe("unavailable");
		expect(minimized.kind === "unavailable" ? minimized.reason : "").toMatch(/not on the current space/);
	});
});

describe("#given no window id #when a point is supplied #then the containing on-screen window wins", () => {
	it("picks the window under the point", () => {
		expect(resolveTargetWindow([first, second], 1234, bothOnscreen, { x: 950, y: 30 })).toEqual({
			kind: "resolved",
			window: toTargetWindow(second),
		});
		expect(resolveTargetWindow([first, second], 1234, bothOnscreen, { x: 10, y: 10 })).toEqual({
			kind: "resolved",
			window: toTargetWindow(first),
		});
	});

	it("falls back to the frontmost on-screen window in WindowServer order, not listing order", () => {
		expect(resolveTargetWindow([first, second], 1234, [200, 100])).toEqual({
			kind: "resolved",
			window: toTargetWindow(second),
		});
		expect(resolveTargetWindow([first, second], 1234, [100, 200])).toEqual({
			kind: "resolved",
			window: toTargetWindow(first),
		});
	});

	it("skips a listed window the WindowServer does not report on screen", () => {
		expect(resolveTargetWindow([first, second], 1234, [200])).toEqual({
			kind: "resolved",
			window: toTargetWindow(second),
		});
	});
});

describe("#given an unreadable on-screen list #when a target is resolved #then input is paused rather than guessed", () => {
	it("refuses and says why", () => {
		const resolution = resolveTargetWindow([first, second], 1234, undefined);

		expect(resolution.kind).toBe("unavailable");
		expect(resolution.kind === "unavailable" ? resolution.reason : "").toMatch(/could not be read/);
	});
});

describe("#given an app whose windows are all off screen #when a target is resolved #then it refuses with a reason", () => {
	it("reports that no window is on the current space", () => {
		const resolution = resolveTargetWindow([first, second], 1234, []);

		expect(resolution.kind).toBe("unavailable");
		expect(resolution.kind === "unavailable" ? resolution.reason : "").toMatch(/no window on the current space/);
	});

	it("reports that no window is on the current space for a point too", () => {
		expect(resolveTargetWindow([first], 1234, [], { x: 10, y: 10 }).kind).toBe("unavailable");
	});
});

describe("#given window enumeration #when filtering by process #then only visible windows of that process are candidates", () => {
	it("excludes other processes and zero-sized windows", () => {
		const candidates = visibleWindowsForPid(
			[
				first,
				second,
				window(400, 5678, { x: 0, y: 0, width: 100, height: 100 }),
				window(500, 1234, { x: 0, y: 0, width: 0, height: 0 }),
			],
			1234,
		);

		expect(candidates.map((candidate) => candidate.id)).toEqual([100, 200]);
	});
});
