import { describe, expect, it } from "vitest";

import { selectVisibleTargetWindow, toTargetWindow, visibleWindowsForPid } from "./macos-window-target.js";
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

describe("#given an app with several windows #when an observed window id is named #then that exact window is resolved", () => {
	it("resolves by id regardless of window order", () => {
		expect(selectVisibleTargetWindow([first, second], 1234, undefined, 200)).toEqual(toTargetWindow(second));
		expect(selectVisibleTargetWindow([second, first], 1234, undefined, 100)).toEqual(toTargetWindow(first));
	});

	it("resolves nothing when the named window is gone instead of retargeting another window", () => {
		expect(selectVisibleTargetWindow([first], 1234, undefined, 999)).toBeUndefined();
	});

	it("ignores a named window that belongs to a different app", () => {
		expect(
			selectVisibleTargetWindow([window(300, 5678, { x: 0, y: 0, width: 10, height: 10 })], 1234, undefined, 300),
		).toBeUndefined();
	});
});

describe("#given no window id #when a point is supplied #then the containing window wins over window order", () => {
	it("picks the window under the point", () => {
		expect(selectVisibleTargetWindow([first, second], 1234, { x: 950, y: 30 })?.id).toBe(200);
		expect(selectVisibleTargetWindow([first, second], 1234, { x: 10, y: 10 })?.id).toBe(100);
	});
});

describe("#given window enumeration #when filtering by process #then only visible windows of that process are candidates", () => {
	it("excludes other processes and zero-sized windows", () => {
		const candidates = visibleWindowsForPid(
			[
				first,
				second,
				window(300, 5678, { x: 0, y: 0, width: 10, height: 10 }),
				window(400, 1234, { x: 0, y: 0, width: 0, height: 0 }),
			],
			1234,
		);

		expect(candidates.map((candidate) => candidate.id)).toEqual([100, 200]);
	});
});
