import { describe, expect, it, vi } from "vitest";

import { type TopLevelWindow, fillWindowTitles } from "./macos-top-level-windows.js";

const BOUNDS = { x: 0, y: 0, width: 400, height: 300 };

function window(id: number, ownerPid: number, title: string): TopLevelWindow {
	return { id, ownerPid, ownerName: `app ${ownerPid}`, title, bounds: BOUNDS };
}

describe("fillWindowTitles #given window titles the WindowServer withheld (no Screen Recording)", () => {
	const listed = [window(1, 10, ""), window(2, 10, ""), window(3, 20, ""), window(4, 30, "Shown")];

	it("#when the apps asked for name their windows #then each untitled window carries its app's title, asking each app once", () => {
		const titlesOfApp = vi.fn((pid: number) =>
			pid === 10
				? new Map([
						[1, "a.txt"],
						[2, "b.txt"],
					])
				: new Map([[3, "Calculator"]]),
		);

		const filled = fillWindowTitles(listed, [10], titlesOfApp);

		expect(filled.map((entry) => entry.title)).toEqual(["a.txt", "b.txt", "", "Shown"]);
		expect(titlesOfApp.mock.calls).toEqual([[10]]);
	});

	it("#when every app is asked #then only apps with an untitled window are asked", () => {
		const titlesOfApp = vi.fn((pid: number) => new Map([[pid === 10 ? 1 : 3, `window of ${pid}`]]));

		const filled = fillWindowTitles(listed, "all", titlesOfApp);

		expect(filled.map((entry) => entry.title)).toEqual(["window of 10", "", "window of 20", "Shown"]);
		expect(titlesOfApp.mock.calls).toEqual([[10], [20]]);
	});

	it("#when an app cannot answer or names a window with nothing #then its windows stay untitled", () => {
		const filled = fillWindowTitles(listed, "all", (pid) => {
			if (pid === 10) {
				throw new Error("the app did not answer within the accessibility messaging timeout");
			}
			return new Map([[3, ""]]);
		});

		expect(filled.map((entry) => entry.title)).toEqual(["", "", "", "Shown"]);
	});
});
