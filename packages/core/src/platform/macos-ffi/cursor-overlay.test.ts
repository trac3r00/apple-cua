import { describe, expect, it, vi } from "vitest";

import { type OverlayProcessHandle, createCursorOverlay } from "./cursor-overlay.js";

function fakeHandle(): OverlayProcessHandle & { writes: string[]; ended: boolean; killed: boolean } {
	const state = { writes: [] as string[], ended: false, killed: false };
	return {
		stdin: {
			write(chunk: string) {
				state.writes.push(chunk);
			},
			end() {
				state.ended = true;
			},
		},
		kill() {
			state.killed = true;
		},
		get writes() {
			return state.writes;
		},
		get ended() {
			return state.ended;
		},
		get killed() {
			return state.killed;
		},
	};
}

describe("#given a spawnable overlay #when driven #then it streams set/hide/quit commands lazily", () => {
	it("spawns once and writes positioning commands", () => {
		const handle = fakeHandle();
		const spawner = vi.fn(() => handle);
		const overlay = createCursorOverlay(spawner);

		overlay.set({ x: 800, y: 500 });
		overlay.set({ x: 12, y: 34 });
		overlay.hide();
		overlay.close();

		expect(spawner).toHaveBeenCalledTimes(1);
		expect(handle.writes).toEqual(["set 800 500\n", "set 12 34\n", "hide\n", "quit\n"]);
		expect(handle.ended).toBe(true);
	});
});

describe("#given a spawnable overlay #when highlighting a window #then it streams a highlight command", () => {
	it("sends rounded window bounds to the helper", () => {
		const handle = fakeHandle();
		const overlay = createCursorOverlay(() => handle);

		overlay.highlight({ x: 100, y: 200, width: 800, height: 600 });

		expect(handle.writes).toEqual(["highlight 100 200 800 600\n"]);
	});
});

describe("#given no overlay binary #when driven #then every call is a safe no-op", () => {
	it("never throws when the spawner yields nothing", () => {
		const overlay = createCursorOverlay(() => undefined);

		expect(() => {
			overlay.set({ x: 1, y: 2 });
			overlay.hide();
			overlay.close();
		}).not.toThrow();
	});
});
