import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null, stdout: string | Buffer, stderr: string) => void;
type ExecFileMock = (
	file: string,
	args: readonly string[],
	options: { readonly encoding?: BufferEncoding; readonly timeout?: number },
	callback: ExecFileCallback,
) => void;

const childProcessMock = vi.hoisted(() => ({ execFile: vi.fn<ExecFileMock>() }));
vi.mock("node:child_process", () => ({ execFile: childProcessMock.execFile }));

type TestWindow = {
	id: number;
	title?: string;
	owner: { processId: number };
	bounds: { x: number; y: number; width: number; height: number };
};
const windowMock = vi.hoisted(() => ({
	openWindows: vi.fn<() => Promise<readonly TestWindow[]>>(() => Promise.resolve([])),
}));
vi.mock("get-windows", () => ({ openWindows: windowMock.openWindows }));

const accessibilityMock = vi.hoisted(() => ({
	extractAccessibilityTree: vi.fn(),
	focusedWindowIdForPid: vi.fn<() => number | undefined>(() => undefined),
	releaseAccessibilitySnapshot: vi.fn(),
	performActionByIndex: vi.fn(),
	pressElementAtScreenPoint: vi.fn(),
	setValueByIndex: vi.fn(),
	typeIntoFocusedAXElement: vi.fn(),
}));

const screenshotMock = vi.hoisted(() => ({
	captureDisplayPng: vi.fn(),
	getMainDisplayId: vi.fn(() => 1),
	captureWindowImage: vi.fn(),
	getMainDisplayLogicalSize: vi.fn(),
	getMainDisplayNativePixelSize: vi.fn(),
}));
vi.mock("./macos-ffi/screenshot.js", () => screenshotMock);
vi.mock("./macos-ffi/accessibility.js", () => accessibilityMock);

import { AppApprovalStore } from "../permission/app-approval.js";
import { setRunningApplicationLookupForTesting } from "./app-list.js";
import type { AccessibilityTreeOptions } from "./macos-ffi/accessibility.js";
import { MacOSHostComputer } from "./macos.js";

/** Forces the AppleScript application-list fallback so the execFile fixtures stay authoritative. */
const unavailableNativeLookup = {
	getRunningApplications: (): never => {
		throw new Error("native application lookup is unavailable in this test");
	},
	findRunningApplication: (): never => {
		throw new Error("native application lookup is unavailable in this test");
	},
};

const TARGET_PID = 1234;
const WINDOW_BOUNDS = { x: 300, y: 150, width: 2560, height: 1600 };

function fakePng(width: number, height: number): Buffer {
	const data = globalThis.Buffer.alloc(24);
	data.write("PNG\r\n\n", 0, "latin1");
	data.writeUInt32BE(width, 16);
	data.writeUInt32BE(height, 20);
	return data;
}

beforeEach(() => {
	setRunningApplicationLookupForTesting(unavailableNativeLookup);
	childProcessMock.execFile.mockReset();
	windowMock.openWindows.mockReset();
	accessibilityMock.extractAccessibilityTree.mockReset();
	accessibilityMock.performActionByIndex.mockReset();
	accessibilityMock.releaseAccessibilitySnapshot.mockReset();
	screenshotMock.captureDisplayPng.mockReset();
	screenshotMock.getMainDisplayLogicalSize.mockReset();
	screenshotMock.getMainDisplayNativePixelSize.mockReset();
	screenshotMock.getMainDisplayLogicalSize.mockReturnValue({ width: 1920, height: 1080 });
	screenshotMock.getMainDisplayNativePixelSize.mockReturnValue({ width: 3840, height: 2160 });
	screenshotMock.captureDisplayPng.mockReturnValue({ data: fakePng(1920, 1080), width: 1920, height: 1080 });

	windowMock.openWindows.mockResolvedValue([{ id: 99, owner: { processId: TARGET_PID }, bounds: WINDOW_BOUNDS }]);
	// Mirrors the real contract: element ids belong to one exact walk, so the key reflects
	// the window scope, menu-bar choice and element budget the caller asked for.
	accessibilityMock.extractAccessibilityTree.mockImplementation(
		(_pid: number, options?: AccessibilityTreeOptions) => ({
			axAvailable: true,
			truncated: false,
			walkKey: JSON.stringify([
				options?.windowId ?? null,
				options?.includeMenuBar === true,
				options?.maxElements ?? 2000,
			]),
			elements: [
				{
					id: 5,
					role: "AXButton",
					label: "Open",
					value: null,
					frame: { x: 800, y: 550, width: 200, height: 160 },
					actions: ["AXPress"],
					children: [],
				},
			],
		}),
	);
	// First execFile call: getRunningMacOSApps (osascript JXA). Second: window screenshot (sh).
	childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
		callback(
			null,
			JSON.stringify([{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true }]),
			"",
		);
	});
	childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
		// The sips step would resize to 1280x800; mirror that in the returned png header.
		callback(null, fakePng(2560, 1600), "");
	});
});

describe("#given a target window #when get_app_state captures it #then the screenshot is sized to the window aspect", () => {
	it("captures the window at full fidelity up to the 2560 long-edge cap, not the full screen", async () => {
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		// WINDOW_BOUNDS is 2560x1600, which fits the raised 2560 cap uncapped.
		expect(state.screenshotWidth).toBe(2560);
		expect(state.screenshotHeight).toBe(1600);
		expect(state.windowBounds).toEqual(WINDOW_BOUNDS);
	});
});

describe("#given an app with several windows #when the observation resolves a target #then it names the window and lists the alternatives", () => {
	it("scopes to the app's focused window and reports every candidate", async () => {
		windowMock.openWindows.mockResolvedValue([
			{ id: 99, title: "Documents", owner: { processId: TARGET_PID }, bounds: WINDOW_BOUNDS },
			{
				id: 42,
				title: "Downloads",
				owner: { processId: TARGET_PID },
				bounds: { x: 0, y: 0, width: 400, height: 300 },
			},
		]);
		accessibilityMock.focusedWindowIdForPid.mockReturnValue(42);
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.windowId).toBe(42);
		expect(state.windowTitle).toBe("Downloads");
		expect(state.windowCandidates?.map((candidate) => candidate.id)).toEqual([99, 42]);
	});

	it("honors an explicitly requested window id over the focused window", async () => {
		accessibilityMock.focusedWindowIdForPid.mockReturnValue(42);
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0, windowId: 99 });

		expect(state.windowId).toBe(99);
	});

	it("reports no candidates when the app has a single window", async () => {
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.windowId).toBe(99);
		expect(state.windowCandidates).toBeUndefined();
	});
});

describe("#given two get_app_state calls #when the second runs #then it reports an AX change summary", () => {
	it("omits the summary on the first call and includes it on the second", async () => {
		childProcessMock.execFile.mockReset();
		for (let call = 0; call < 2; call += 1) {
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(
					null,
					JSON.stringify([{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true }]),
					"",
				);
			});
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(null, fakePng(2560, 1600), "");
			});
		}
		const computer = new MacOSHostComputer();

		const first = await computer.getAppState(TARGET_PID, { settleMs: 0 });
		const second = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(first.axChangeSummary).toBeUndefined();
		expect(second.axChangeSummary).toEqual({ added: 0, removed: 0, changed: 0 });
	});

	it("omits the diff when the previous walk used a different scope", async () => {
		childProcessMock.execFile.mockReset();
		for (let call = 0; call < 2; call += 1) {
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(
					null,
					JSON.stringify([{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true }]),
					"",
				);
			});
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(null, fakePng(2560, 1600), "");
			});
		}
		const computer = new MacOSHostComputer();

		await computer.getAppState(TARGET_PID, { settleMs: 0, includeMenuBar: true });
		const afterScopeChange = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(afterScopeChange.axChangeSummary).toBeUndefined();
		expect(afterScopeChange.axChanges).toBeUndefined();
	});

	it("exposes the element-level diff on the second call", async () => {
		childProcessMock.execFile.mockReset();
		for (let call = 0; call < 2; call += 1) {
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(
					null,
					JSON.stringify([{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true }]),
					"",
				);
			});
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(null, fakePng(2560, 1600), "");
			});
		}
		const baseElement = {
			id: 5,
			role: "AXButton",
			label: "Open",
			value: null,
			frame: { x: 800, y: 550, width: 200, height: 160 },
			actions: ["AXPress"],
			children: [],
		};
		accessibilityMock.extractAccessibilityTree
			.mockReturnValueOnce({ axAvailable: true, elements: [baseElement] })
			.mockReturnValue({
				axAvailable: true,
				elements: [
					baseElement,
					{ ...baseElement, id: 6, label: "New", frame: { x: 100, y: 100, width: 50, height: 50 } },
				],
			});
		const computer = new MacOSHostComputer();

		const first = await computer.getAppState(TARGET_PID, { settleMs: 0 });
		const second = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(first.axChanges).toBeUndefined();
		expect(second.axChanges?.added.map((element) => element.label)).toEqual(["New"]);
		expect(second.axChanges?.removed).toEqual([]);
		expect(second.axChanges?.changed).toEqual([]);
	});
});

describe("#given diff_only mode #when a prior snapshot exists #then the full tree is omitted and only the diff returned", () => {
	it("returns the full tree on the first call and only axChanges on the second", async () => {
		childProcessMock.execFile.mockReset();
		for (let call = 0; call < 2; call += 1) {
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(
					null,
					JSON.stringify([{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true }]),
					"",
				);
			});
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
				callback(null, fakePng(2560, 1600), "");
			});
		}
		const computer = new MacOSHostComputer();

		const first = await computer.getAppState(TARGET_PID, { settleMs: 0, diffOnly: true });
		const second = await computer.getAppState(TARGET_PID, { settleMs: 0, diffOnly: true });

		// First call: no prior snapshot, so the full tree is always returned.
		expect(first.elements.length).toBeGreaterThan(0);
		// Second call: diff_only omits the full tree and returns only the diff.
		expect(second.elements).toEqual([]);
		expect(second.axChanges).toBeDefined();
		expect(second.axChangeSummary).toBeDefined();
		expect(second.contentKind).toBeDefined();
	});
});

describe("#given an app-approval store #when an app is not approved #then get_app_state is refused until approved", () => {
	it("refuses an unapproved app and proceeds once approved for the session", async () => {
		const appsJson = JSON.stringify([
			{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true },
		]);
		childProcessMock.execFile.mockReset();
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
			callback(null, appsJson, ""),
		);
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
			callback(null, appsJson, ""),
		);
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
			callback(null, fakePng(2560, 1600), ""),
		);
		const approval = new AppApprovalStore();
		const computer = new MacOSHostComputer({ appApproval: approval });

		await expect(computer.getAppState(TARGET_PID, { settleMs: 0 })).rejects.toThrow(/needs your approval/);

		approval.approveForSession("com.apple.finder");
		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });
		expect(state.app).toBe("Finder");
	});
});

describe("#given a URL blocklist #when a browser is on a blocked URL #then get_app_state is refused", () => {
	it("refuses Safari on a blocklisted URL", async () => {
		childProcessMock.execFile.mockReset();
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
			callback(
				null,
				JSON.stringify([{ name: "Safari", bundleId: "com.apple.Safari", pid: TARGET_PID, isActive: true }]),
				"",
			),
		);
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
			callback(null, "https://banking.example.com/login\n", ""),
		);
		const computer = new MacOSHostComputer({ urlBlocklist: ["*banking*"] });

		await expect(computer.getAppState(TARGET_PID, { settleMs: 0 })).rejects.toThrow(
			/not allowed on the current browser URL/,
		);
	});
});

describe("#given a fresh app session #when get_app_state runs #then it highlights the window once", () => {
	it("fires the capture-start highlight on the first windowed call only", async () => {
		const overlay = { set: vi.fn(), highlight: vi.fn(), setMode: vi.fn(), hide: vi.fn(), close: vi.fn() };
		const appsJson = JSON.stringify([
			{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true },
		]);
		childProcessMock.execFile.mockReset();
		for (let call = 0; call < 2; call += 1) {
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
				callback(null, appsJson, ""),
			);
			childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) =>
				callback(null, fakePng(2560, 1600), ""),
			);
		}
		const computer = new MacOSHostComputer({ overlay });

		await computer.getAppState(TARGET_PID, { settleMs: 0 });
		await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(overlay.highlight).toHaveBeenCalledTimes(1);
		expect(overlay.highlight).toHaveBeenCalledWith(WINDOW_BOUNDS);
	});
});

describe("#given a noisy accessibility tree #when get_app_state runs #then non-descriptive nodes are pruned", () => {
	it("drops AXUnknown noise while keeping descriptive elements", async () => {
		accessibilityMock.extractAccessibilityTree.mockReturnValue({
			axAvailable: true,
			elements: [
				{
					id: 5,
					role: "AXButton",
					label: "Open",
					value: null,
					frame: { x: 800, y: 550, width: 200, height: 160 },
					actions: ["AXPress"],
					children: [],
				},
				{
					id: 6,
					role: "AXUnknown",
					label: null,
					value: null,
					frame: { x: 0, y: 0, width: 0, height: 0 },
					actions: [],
					children: [],
				},
			],
		});
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.elements.map((element) => element.id)).toEqual([5]);
		await computer.performAction(TARGET_PID, state.elements[0]?.id ?? -1, "AXPress");
		expect(accessibilityMock.performActionByIndex).toHaveBeenCalledWith(TARGET_PID, 5, "AXPress");
	});
});

describe("#given a known app #when get_app_state runs #then it includes the app-specific instruction playbook", () => {
	it("attaches Clock instructions for com.apple.clock", async () => {
		childProcessMock.execFile.mockReset();
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
			callback(
				null,
				JSON.stringify([{ name: "Clock", bundleId: "com.apple.clock", pid: TARGET_PID, isActive: true }]),
				"",
			);
		});
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
			callback(null, fakePng(2560, 1600), "");
		});
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.appInstructions).toContain("World Clock");
	});
});

describe("#given a Retina display #when get_app_state runs #then it reports display geometry and backing scale", () => {
	it("includes the logical display size and scale factor", async () => {
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.display).toEqual({ width: 1920, height: 1080, scaleFactor: 2 });
	});
});

describe("#given a window-scoped screenshot #when get_app_state returns the tree #then frames share the screenshot pixel space", () => {
	it("remaps global accessibility frames into screenshot pixels", async () => {
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		// scale = 2560/2560 = 1.0; origin offset = window (300,150).
		expect(state.elements[0]?.frame).toEqual({ x: 500, y: 400, width: 200, height: 160 });
		// id and actions are preserved so element_index clicks still work.
		expect(state.elements[0]?.id).toBe(5);
		expect(state.elements[0]?.actions).toEqual(["AXPress"]);
	});
});

describe("#given a prior get_app_state #when reading the screenshot viewport #then it maps pixels onto the window", () => {
	it("exposes the stored viewport for the target pid", async () => {
		const computer = new MacOSHostComputer();
		await computer.getAppState(TARGET_PID, { settleMs: 0 });

		const viewport = await computer.getScreenshotViewport(TARGET_PID);

		expect(viewport).toEqual({ windowBounds: WINDOW_BOUNDS, screenshotWidth: 2560, screenshotHeight: 1600 });
	});
});

describe("#given no prior get_app_state #when reading the screenshot viewport #then it derives one from the current window", () => {
	it("derives the viewport from the live target window", async () => {
		const computer = new MacOSHostComputer();

		const viewport = await computer.getScreenshotViewport(TARGET_PID);

		expect(viewport).toEqual({ windowBounds: WINDOW_BOUNDS, screenshotWidth: 2560, screenshotHeight: 1600 });
	});

	it("returns undefined when the target app has no visible window", async () => {
		windowMock.openWindows.mockResolvedValue([]);
		const computer = new MacOSHostComputer();

		expect(await computer.getScreenshotViewport(TARGET_PID)).toBeUndefined();
	});
});

describe("#given no target window #when get_app_state captures the full display #then frames stay in global space", () => {
	it("leaves accessibility frames unscaled and reports no window bounds", async () => {
		windowMock.openWindows.mockResolvedValue([]);
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.windowBounds).toBeUndefined();
		expect(state.elements[0]?.frame).toEqual({ x: 800, y: 550, width: 200, height: 160 });
		expect(state.screenshotWidth).toBe(1920);
		expect(await computer.getScreenshotViewport(TARGET_PID)).toBeUndefined();
	});
});

describe("#given an accessibility tree that stabilizes #when get_app_state settles #then it stops at stability, not the cap", () => {
	it("polls the tree until it is stable and returns before the settle cap elapses", async () => {
		vi.useFakeTimers();
		try {
			const stableElement = {
				id: 5,
				role: "AXButton",
				label: "Open",
				value: null,
				frame: { x: 800, y: 550, width: 200, height: 160 },
				actions: ["AXPress"],
				children: [],
			};
			// First poll: tree still changing (extra element). Subsequent polls: stable.
			accessibilityMock.extractAccessibilityTree
				.mockReturnValueOnce({
					axAvailable: true,
					elements: [stableElement, { ...stableElement, id: 6, label: "Transient" }],
				})
				.mockReturnValue({ axAvailable: true, elements: [stableElement] });
			const computer = new MacOSHostComputer();

			const statePromise = computer.getAppState(TARGET_PID, { settleMs: 500 });
			// Let the event-driven settle loop run its (short) poll intervals.
			await vi.advanceTimersByTimeAsync(200);

			// Must have finished WITHOUT advancing the full 500ms cap.
			const state = await statePromise;
			expect(state.elements.map((element) => element.id)).toEqual([5]);
			// Event-driven settle polls the tree more than once to confirm stability.
			expect(accessibilityMock.extractAccessibilityTree.mock.calls.length).toBeGreaterThan(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns immediately once the tree is already stable instead of sleeping the whole cap", async () => {
		vi.useFakeTimers();
		try {
			const computer = new MacOSHostComputer();

			const statePromise = computer.getAppState(TARGET_PID, { settleMs: 500 });
			// Advance far less than the 500ms cap; a stable tree settles right away.
			await vi.advanceTimersByTimeAsync(120);

			const state = await statePromise;
			expect(state.pid).toBe(TARGET_PID);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("#given an observed AX app #when the host closes #then its retained accessibility snapshot is released", () => {
	it("releases each observed pid", async () => {
		const computer = new MacOSHostComputer();
		await computer.getAppState(TARGET_PID, { settleMs: 0 });

		await computer.close();

		expect(accessibilityMock.releaseAccessibilitySnapshot).toHaveBeenCalledOnce();
		expect(accessibilityMock.releaseAccessibilitySnapshot).toHaveBeenCalledWith(TARGET_PID);
	});
});

describe("#given a window on a secondary display #when get_app_state remaps frames #then negative origins are handled", () => {
	it("offsets frames by the negative window origin", async () => {
		const negativeBounds = { x: -1920, y: -200, width: 960, height: 600 };
		windowMock.openWindows.mockResolvedValue([{ id: 99, owner: { processId: TARGET_PID }, bounds: negativeBounds }]);
		accessibilityMock.extractAccessibilityTree.mockReturnValue({
			axAvailable: true,
			elements: [
				{
					id: 5,
					role: "AXButton",
					label: "Open",
					value: null,
					frame: { x: -1440, y: 100, width: 96, height: 60 },
					actions: ["AXPress"],
					children: [],
				},
			],
		});
		childProcessMock.execFile.mockReset();
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
			callback(
				null,
				JSON.stringify([{ name: "Finder", bundleId: "com.apple.finder", pid: TARGET_PID, isActive: true }]),
				"",
			);
		});
		childProcessMock.execFile.mockImplementationOnce((_file, _args, _options, callback) => {
			callback(null, fakePng(960, 600), "");
		});
		const computer = new MacOSHostComputer();

		const state = await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(state.windowBounds).toEqual(negativeBounds);
		// scale = 960/960 = 1; offset = -(-1920, -200): (-1440+1920, 100+200).
		expect(state.elements[0]?.frame).toEqual({ x: 480, y: 300, width: 96, height: 60 });
	});
});
