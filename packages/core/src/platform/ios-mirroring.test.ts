import { describe, expect, it } from "vitest";
import {
	classifyMirroringSession,
	describeMirroringState,
	ocrTextsToScreenPoints,
	selectMirroringWindow,
	windowOwnsPoint,
} from "./ios-mirroring.js";
import type { TopLevelWindow } from "./macos-top-level-windows.js";

const MIRRORING_PID = 9001;
const OTHER_PID = 4242;

function window(overrides: Partial<TopLevelWindow> & { readonly id: number }): TopLevelWindow {
	return {
		ownerPid: MIRRORING_PID,
		ownerName: "iPhone Mirroring",
		title: "iPhone Mirroring",
		bounds: { x: 100, y: 200, width: 300, height: 600 },
		...overrides,
	};
}

describe("#given a window list #when the mirroring window is selected #then the app's own frontmost normal window wins", () => {
	it("ignores other applications and takes the first of the app's windows", () => {
		const windows: readonly TopLevelWindow[] = [
			window({ id: 1, ownerPid: OTHER_PID, ownerName: "Safari", bounds: { x: 0, y: 0, width: 900, height: 900 } }),
			window({ id: 2, bounds: { x: 120, y: 240, width: 320, height: 640 } }),
			window({ id: 3 }),
		];

		expect(selectMirroringWindow(windows, MIRRORING_PID)?.id).toBe(2);
	});

	it("keeps a window macOS has shrunk for Stage Manager instead of reporting the phone as missing", () => {
		// A parked window measures roughly 38x130. The size guard that used to live here discarded it
		// and every other app taking the stage looked like a disconnected phone.
		const windows: readonly TopLevelWindow[] = [window({ id: 7, bounds: { x: 12, y: 300, width: 38, height: 130 } })];

		expect(selectMirroringWindow(windows, MIRRORING_PID)?.id).toBe(7);
	});

	it("reports no window when the app owns none", () => {
		expect(selectMirroringWindow([window({ id: 1, ownerPid: OTHER_PID })], MIRRORING_PID)).toBeUndefined();
	});
});

describe("#given a point on screen #when asking whether the phone window owns it #then the topmost window answers", () => {
	it("is true when the phone window is the frontmost window there", () => {
		const windows: readonly TopLevelWindow[] = [window({ id: 2 })];

		expect(windowOwnsPoint(windows, MIRRORING_PID, 200, 400)).toBe(true);
	});

	it("is false when another window sits over the phone at that point", () => {
		const windows: readonly TopLevelWindow[] = [
			window({ id: 1, ownerPid: OTHER_PID, ownerName: "Chrome", bounds: { x: 0, y: 0, width: 900, height: 900 } }),
			window({ id: 2 }),
		];

		expect(windowOwnsPoint(windows, MIRRORING_PID, 200, 400)).toBe(false);
	});

	it("is false outside the phone window, so a gesture is never aimed off it", () => {
		expect(windowOwnsPoint([window({ id: 2 })], MIRRORING_PID, 10, 10)).toBe(false);
	});
});

describe("#given what the machine reports #when the session state is classified #then a connected phone and an interstitial are told apart structurally", () => {
	it("reports not-running when the app is not running at all", () => {
		expect(classifyMirroringSession({ running: false, hasWindow: false, axContent: [], screenTexts: [] })).toBe(
			"not-running",
		);
	});

	it("reports no-window when the app runs without a phone window", () => {
		expect(classifyMirroringSession({ running: true, hasWindow: false, axContent: [], screenTexts: [] })).toBe(
			"no-window",
		);
	});

	it("reports blocked when the window carries real UI, which a live phone image never does", () => {
		const state = classifyMirroringSession({
			running: true,
			hasWindow: true,
			axContent: [{ role: "AXStaticText", text: "iPhone in Use" }],
			screenTexts: [],
		});

		expect(state).toBe("blocked");
	});

	it("reports ready for a connected phone, in any language, with no markers to match", () => {
		expect(classifyMirroringSession({ running: true, hasWindow: true, axContent: [], screenTexts: [] })).toBe(
			"ready",
		);
	});

	it("still blocks on the known interstitial phrases when accessibility cannot see the window", () => {
		const state = classifyMirroringSession({
			running: true,
			hasWindow: true,
			axContent: [],
			screenTexts: ["Mirroring ended", "Reconnect"],
		});

		expect(state).toBe("blocked");
	});
});

describe("#given OCR boxes in image pixels #when they are mapped into screen points #then a Retina capture and a point capture agree", () => {
	const window = { id: 2, x: 100, y: 200, width: 400, height: 800 };

	it("scales image pixels by the ratio between the window and the capture", () => {
		const [text] = ocrTextsToScreenPoints(
			[{ text: "Settings", confidence: 1, box: { x: 200, y: 400, width: 100, height: 40 } }],
			window,
			800,
			1600,
		);

		expect(text).toEqual({ text: "Settings", confidence: 1, x: 200, y: 400, width: 50, height: 20 });
	});

	it("is the identity when the capture is in points, which is what a 1x display gives", () => {
		const [text] = ocrTextsToScreenPoints(
			[{ text: "Wi-Fi", confidence: 1, box: { x: 60, y: 310, width: 90, height: 30 } }],
			window,
			400,
			800,
		);

		expect(text).toEqual({ text: "Wi-Fi", confidence: 1, x: 160, y: 510, width: 90, height: 30 });
	});
});

describe("#given a session that cannot be used #when the state is described #then the message names what the user has to do", () => {
	it("sends the user to the app for a phone that is not connected", () => {
		expect(describeMirroringState("not-running")).toMatch(/iPhone Mirroring/);
		expect(describeMirroringState("no-window")).toMatch(/connect/i);
	});

	it("tells the user to clear the interstitial rather than tapping through it", () => {
		const message = describeMirroringState("blocked", "iPhone in Use");

		expect(message).toMatch(/iPhone in Use/);
		expect(message).toMatch(/lock/i);
	});
});
