import { describe, expect, it, vi } from "vitest";

import type { ListedWindow } from "./macos-ffi/window-list.js";
import { openWindowsForTargeting, targetableWindows } from "./macos-open-windows.js";
import type { MacOSWindowInfo } from "./macos-window-target.js";

function listed(partial: Partial<ListedWindow> & { id: number }): ListedWindow {
	return {
		ownerPid: 100,
		layer: 0,
		ownerName: "Finder",
		title: "",
		bounds: { x: 0, y: 0, width: 100, height: 100 },
		...partial,
	};
}

function window(id: number): MacOSWindowInfo {
	return { id, bounds: { x: 0, y: 0, width: 10, height: 10 } };
}

describe("#given a WindowServer listing with app windows and chrome #when it is mapped for targeting #then only normal windows survive", () => {
	it("keeps layer 0 and drops menu bar, control centre and drag-helper layers", () => {
		const windows = targetableWindows([
			listed({ id: 1, ownerName: "Finder", title: "apple-cua", bounds: { x: 10, y: 20, width: 30, height: 40 } }),
			listed({ id: 2, layer: 25, ownerName: "Control Center", title: "Item-0" }),
			listed({ id: 3, layer: 500, ownerName: "SSDragHelper" }),
		]);

		expect(windows).toEqual([
			{
				id: 1,
				bounds: { x: 10, y: 20, width: 30, height: 40 },
				owner: { processId: 100, name: "Finder" },
				title: "apple-cua",
				layer: 0,
			},
		]);
	});
});

describe("#given the in-process listing answers #when windows are wanted for targeting #then the helper binary is never consulted", () => {
	it("uses the in-process listing as-is, chrome already filtered", async () => {
		const listBinary = vi.fn(async () => [window(99)]);

		const windows = await openWindowsForTargeting({ listNative: () => [window(1), window(2)], listBinary });

		expect(windows.map((entry) => entry.id)).toEqual([1, 2]);
		expect(listBinary).not.toHaveBeenCalled();
	});

	it("answers an empty in-process list as an empty list instead of falling back", async () => {
		const listBinary = vi.fn(async () => [window(99)]);

		const windows = await openWindowsForTargeting({ listNative: () => [], listBinary });

		expect(windows).toEqual([]);
		expect(listBinary).not.toHaveBeenCalled();
	});
});

describe("#given the in-process binding cannot read windows #when windows are wanted for targeting #then the helper binary answers", () => {
	it("falls back to the binary listing", async () => {
		const windows = await openWindowsForTargeting({
			listNative: () => undefined,
			listBinary: async () => [window(7)],
		});

		expect(windows.map((entry) => entry.id)).toEqual([7]);
	});
});
