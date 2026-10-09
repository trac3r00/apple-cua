import { describe, expect, it, vi } from "vitest";

import { type OverlayTransport, createCursorOverlay } from "./cursor-overlay.js";

function fakeTransport(): OverlayTransport & { sends: string[]; closed: boolean } {
	const state = { sends: [] as string[], closed: false };
	return {
		send(command: string) {
			state.sends.push(command);
		},
		close() {
			state.closed = true;
		},
		get sends() {
			return state.sends;
		},
		get closed() {
			return state.closed;
		},
	};
}

describe("#given an overlay transport #when driven #then it streams set/hide commands lazily", () => {
	it("resolves the transport once and forwards positioning commands", () => {
		const transport = fakeTransport();
		const factory = vi.fn(() => transport);
		const overlay = createCursorOverlay(factory);

		overlay.set({ x: 800, y: 500 });
		overlay.set({ x: 12, y: 34 });
		overlay.hide();
		overlay.close();

		expect(factory).toHaveBeenCalledTimes(1);
		// close() must NOT emit "quit": the daemon is shared across commands and
		// self-terminates on its idle timeout. Quitting here is the "cursor never
		// showed" bug (it died the instant a single verb's process exited).
		expect(transport.sends).toEqual(["set 800 500\n", "set 12 34\n", "hide\n"]);
		expect(transport.closed).toBe(true);
	});
});

describe("#given an overlay transport #when highlighting a window #then it forwards a highlight command", () => {
	it("sends rounded window bounds", () => {
		const transport = fakeTransport();
		const overlay = createCursorOverlay(() => transport);

		overlay.highlight({ x: 100, y: 200, width: 800, height: 600 });

		expect(transport.sends).toEqual(["highlight 100 200 800 600\n"]);
	});
});

describe("#given no overlay transport #when driven #then every call is a safe no-op", () => {
	it("never throws when the factory yields nothing", () => {
		const overlay = createCursorOverlay(() => undefined);

		expect(() => {
			overlay.set({ x: 1, y: 2 });
			overlay.hide();
			overlay.close();
		}).not.toThrow();
	});
});

describe("#given invalid core motion options #when creating the overlay #then validation precedes native startup", () => {
	it("rejects out-of-range geometry without opening the transport", () => {
		const factory = vi.fn(fakeTransport);

		expect(() => createCursorOverlay(factory, { style: "signature_arc", arcSize: 2 })).toThrow(/arcSize/);
		expect(factory).not.toHaveBeenCalled();
	});
});
