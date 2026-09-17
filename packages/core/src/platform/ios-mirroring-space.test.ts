import { describe, expect, it } from "vitest";
import { chooseMirroringWindow } from "./ios-mirroring.js";
import type { TopLevelWindow } from "./macos-top-level-windows.js";

const MIRRORING_PID = 9001;

function window(overrides: Partial<TopLevelWindow> & { readonly id: number }): TopLevelWindow {
	return {
		ownerPid: MIRRORING_PID,
		ownerName: "iPhone Mirroring",
		title: "iPhone Mirroring",
		bounds: { x: 100, y: 200, width: 300, height: 600 },
		...overrides,
	};
}

describe("#given a phone window parked on another Space #when the mirroring window is chosen #then it is still found instead of reported as disconnected", () => {
	it("prefers the window on the current Space", () => {
		const onScreen = [window({ id: 2 })];
		const allSpaces = [window({ id: 1, bounds: { x: 0, y: 0, width: 320, height: 660 } }), window({ id: 2 })];

		const chosen = chooseMirroringWindow(onScreen, allSpaces, MIRRORING_PID);

		expect(chosen?.window.id).toBe(2);
		expect(chosen?.offCurrentSpace).toBe(false);
	});

	it("falls back to the all-Spaces list, and says so", () => {
		const allSpaces = [window({ id: 7, bounds: { x: 0, y: 0, width: 320, height: 660 } })];

		const chosen = chooseMirroringWindow([], allSpaces, MIRRORING_PID);

		expect(chosen?.window.id).toBe(7);
		expect(chosen?.offCurrentSpace).toBe(true);
	});

	it("finds nothing when neither list has a window of that process", () => {
		expect(chooseMirroringWindow([], [window({ id: 3, ownerPid: 4242 })], MIRRORING_PID)).toBeUndefined();
	});
});
