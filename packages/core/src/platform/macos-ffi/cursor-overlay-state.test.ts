import { describe, expect, it, vi } from "vitest";

import { parseCursorState } from "./cursor-motion.js";
import { type OverlayTransport, createCursorOverlay } from "./cursor-overlay.js";

describe("#given a native cursor state response #when parsed #then it retains the reported mode", () => {
	it("returns mode alongside the cursor state", () => {
		expect(parseCursorState('{"x":12,"y":34,"shown":true,"mode":"thinking","reducedMotion":false}')).toEqual({
			x: 12,
			y: 34,
			shown: true,
			mode: "thinking",
			reducedMotion: false,
		});
	});
});

describe("#given a responsive overlay transport #when state is queried #then it returns daemon state", () => {
	it("returns the state payload", async () => {
		const transport: OverlayTransport = {
			send: vi.fn(),
			async queryState() {
				return { x: 12, y: 34, shown: true, mode: "pointer", reducedMotion: false };
			},
			close: vi.fn(),
		};
		const overlay = createCursorOverlay(() => transport);

		await expect(overlay.state?.()).resolves.toEqual({
			x: 12,
			y: 34,
			shown: true,
			mode: "pointer",
			reducedMotion: false,
		});
	});
});

describe("#given an unavailable overlay transport #when state is queried #then it returns null", () => {
	it("returns null without failing", async () => {
		const overlay = createCursorOverlay(() => undefined);

		await expect(overlay.state?.()).resolves.toBeNull();
	});
});
