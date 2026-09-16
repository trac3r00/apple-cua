import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRunningApplicationLookupForTesting } from "./app-list.js";

interface TestWindow {
	readonly id: number;
	readonly owner: { readonly processId: number };
	readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

/** Forces the AppleScript application-list fallback so the fixtures below stay authoritative. */
const unavailableNativeLookup = {
	getRunningApplications: (): never => {
		throw new Error("native application lookup is unavailable in this test");
	},
	findRunningApplication: (): never => {
		throw new Error("native application lookup is unavailable in this test");
	},
};

type ExecFileCallback = (error: Error | null, stdout: string | Buffer, stderr: string) => void;
type ExecFileMock = (
	file: string,
	args: readonly string[],
	options: { readonly encoding?: BufferEncoding; readonly timeout?: number },
	callback: ExecFileCallback,
) => void;

const runtime = vi.hoisted(() => ({
	apps: [{ name: "Finder", bundleId: "com.apple.finder", pid: 1234, isActive: true }],
	browserUrl: "https://example.com/",
	browserUrlError: undefined as Error | undefined,
	screenshotError: undefined as Error | undefined,
}));

const childProcessMock = vi.hoisted(() => ({ execFile: vi.fn<ExecFileMock>() }));
const windowMock = vi.hoisted(() => ({ openWindows: vi.fn<() => Promise<readonly TestWindow[]>>() }));
const accessibilityMock = vi.hoisted(() => ({
	extractAccessibilityTree: vi.fn(),
	focusedWindowIdForPid: vi.fn(() => undefined),
	releaseAccessibilitySnapshot: vi.fn(),
	currentObservationKey: vi.fn(() => "0:test"),
	performActionByIndex: vi.fn(),
	pressElementAtScreenPoint: vi.fn(),
	setValueByIndex: vi.fn(),
	typeIntoFocusedAXElement: vi.fn(),
}));
const screenshotMock = vi.hoisted(() => ({
	captureDisplayImage: vi.fn(),
	getMainDisplayId: vi.fn(() => 1),
	getMainDisplayLogicalSize: vi.fn(),
	getMainDisplayNativePixelSize: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: childProcessMock.execFile }));
vi.mock("get-windows", () => ({ openWindows: windowMock.openWindows }));
vi.mock("./macos-ffi/accessibility.js", () => accessibilityMock);
vi.mock("./macos-ffi/screenshot.js", () => screenshotMock);

import type { InputObservation } from "../computer/guarded-interface.js";
import { AppApprovalStore } from "../permission/app-approval.js";
import { NOOP_POINTER_OVERLAY } from "./macos-ffi/cursor-overlay.js";
import { MacOSHostComputer } from "./macos.js";

const TARGET_PID = 1234;
const BUNDLE_ID = "com.apple.finder";
const WINDOW_BOUNDS = { x: 100, y: 50, width: 800, height: 600 };

function fakePng(width = 800, height = 600): Buffer {
	const data = globalThis.Buffer.alloc(24);
	data.write("\u0089PNG\r\n\u001a\n", 0, "latin1");
	data.writeUInt32BE(width, 16);
	data.writeUInt32BE(height, 20);
	return data;
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(value: T): void {
			if (resolvePromise === undefined) {
				throw new Error("deferred promise was not initialized");
			}
			resolvePromise(value);
		},
	};
}

function approvedComputer(options: { readonly urlBlocklist?: readonly string[] } = {}): MacOSHostComputer {
	return new MacOSHostComputer({
		appApproval: new AppApprovalStore([BUNDLE_ID]),
		overlay: NOOP_POINTER_OVERLAY,
		...options,
	});
}

async function observe(computer: MacOSHostComputer, diffOnly = false): Promise<InputObservation> {
	await computer.getAppState(TARGET_PID, { settleMs: 0, diffOnly, requireWindow: true });
	const observation = computer.getInputObservation(TARGET_PID);
	if (observation === undefined) {
		throw new Error("expected an input observation after successful getAppState");
	}
	return observation;
}

beforeEach(() => {
	runtime.apps = [{ name: "Finder", bundleId: BUNDLE_ID, pid: TARGET_PID, isActive: true }];
	runtime.browserUrl = "https://example.com/";
	runtime.browserUrlError = undefined;
	runtime.screenshotError = undefined;
	// This suite feeds the application list through the AppleScript path, so the native
	// NSWorkspace lookup is declared unavailable and the documented fallback runs.
	setRunningApplicationLookupForTesting(unavailableNativeLookup);

	childProcessMock.execFile.mockReset();
	childProcessMock.execFile.mockImplementation((file, args, _options, callback) => {
		if (file === "osascript" && args.includes("JavaScript")) {
			callback(null, JSON.stringify(runtime.apps), "");
			return;
		}
		if (file === "osascript") {
			if (runtime.browserUrlError !== undefined) {
				callback(runtime.browserUrlError, "", "");
				return;
			}
			callback(null, `${runtime.browserUrl}\n`, "");
			return;
		}
		if (file === "sh") {
			if (runtime.screenshotError !== undefined) {
				callback(runtime.screenshotError, "", "");
				return;
			}
			callback(null, fakePng(), "");
			return;
		}
		callback(new Error(`unexpected executable: ${file}`), "", "");
	});

	windowMock.openWindows.mockReset();
	windowMock.openWindows.mockResolvedValue([{ id: 99, owner: { processId: TARGET_PID }, bounds: WINDOW_BOUNDS }]);
	accessibilityMock.extractAccessibilityTree.mockReset();
	accessibilityMock.extractAccessibilityTree.mockReturnValue({
		axAvailable: true,
		elements: [
			{
				id: 5,
				role: "AXButton",
				label: "Open",
				value: null,
				frame: { x: 150, y: 100, width: 100, height: 40 },
				actions: ["AXPress"],
				children: [],
			},
			{
				id: 7,
				role: "",
				label: null,
				value: null,
				frame: { x: 0, y: 0, width: 0, height: 0 },
				actions: [],
				children: [],
			},
			{
				id: 9,
				role: "AXTextField",
				label: "Name",
				value: "",
				frame: { x: 150, y: 160, width: 200, height: 40 },
				actions: [],
				children: [],
			},
		],
	});
	accessibilityMock.releaseAccessibilitySnapshot.mockReset();
	screenshotMock.captureDisplayImage.mockReset();
	screenshotMock.captureDisplayImage.mockReturnValue({ data: fakePng(), width: 800, height: 600 });
	screenshotMock.getMainDisplayLogicalSize.mockReset();
	screenshotMock.getMainDisplayLogicalSize.mockReturnValue({ width: 1440, height: 900 });
	screenshotMock.getMainDisplayNativePixelSize.mockReset();
	screenshotMock.getMainDisplayNativePixelSize.mockReturnValue({ width: 2880, height: 1800 });
});

describe("MacOSHostComputer input observations", () => {
	it("authorizes the full normalized id set while excluding raw nodes pruned from model output", async () => {
		const computer = approvedComputer();
		const firstState = await computer.getAppState(TARGET_PID, { settleMs: 0, requireWindow: true });
		const first = computer.getInputObservation(TARGET_PID);
		if (first === undefined) {
			throw new Error("expected first input observation");
		}
		const secondState = await computer.getAppState(TARGET_PID, {
			settleMs: 0,
			diffOnly: true,
			requireWindow: true,
		});
		const second = computer.getInputObservation(TARGET_PID);

		expect(firstState.elements.map((element) => element.id)).toEqual([5, 9]);
		expect(secondState.elements).toEqual([]);
		expect(second).toEqual({
			generation: first.generation + 1,
			pid: TARGET_PID,
			bundleId: BUNDLE_ID,
			windowId: 99,
			windowBounds: WINDOW_BOUNDS,
			screenshotViewport: { width: 800, height: 600, bounds: WINDOW_BOUNDS },
			observedElementIds: new Set([5, 9]),
		});
	});

	it("keeps getInputObservation as a pure getter with no native reads", async () => {
		const computer = approvedComputer();
		const expected = await observe(computer);
		const appReads = childProcessMock.execFile.mock.calls.length;
		const windowReads = windowMock.openWindows.mock.calls.length;
		const axReads = accessibilityMock.extractAccessibilityTree.mock.calls.length;

		expect(computer.getInputObservation(TARGET_PID)).toBe(expected);
		expect(computer.getInputObservation(9999)).toBeUndefined();
		expect(childProcessMock.execFile).toHaveBeenCalledTimes(appReads);
		expect(windowMock.openWindows).toHaveBeenCalledTimes(windowReads);
		expect(accessibilityMock.extractAccessibilityTree).toHaveBeenCalledTimes(axReads);
	});

	it("does not create an observation for the low-level full-display fallback", async () => {
		windowMock.openWindows.mockResolvedValue([]);
		const computer = approvedComputer();

		await computer.getAppState(TARGET_PID, { settleMs: 0 });

		expect(computer.getInputObservation(TARGET_PID)).toBeUndefined();
		expect(screenshotMock.captureDisplayImage).toHaveBeenCalledOnce();
	});

	it("requires a visible window before guarded capture and invalidates the prior observation", async () => {
		const computer = approvedComputer();
		await observe(computer);
		windowMock.openWindows.mockResolvedValue([]);
		const screenshotReads = childProcessMock.execFile.mock.calls.filter(([file]) => file === "sh").length;
		const axReads = accessibilityMock.extractAccessibilityTree.mock.calls.length;

		await expect(computer.getAppState(TARGET_PID, { settleMs: 0, requireWindow: true })).rejects.toThrow(
			/visible target window/i,
		);

		expect(childProcessMock.execFile.mock.calls.filter(([file]) => file === "sh")).toHaveLength(screenshotReads);
		expect(screenshotMock.captureDisplayImage).not.toHaveBeenCalled();
		expect(accessibilityMock.extractAccessibilityTree).toHaveBeenCalledTimes(axReads);
		expect(computer.getInputObservation(TARGET_PID)).toBeUndefined();
	});

	it.each(["empty", "error"] as const)(
		"fails a strict guarded browser read before capture when URL lookup returns %s",
		async (failure) => {
			runtime.apps = [{ name: "Safari", bundleId: "com.apple.Safari", pid: TARGET_PID, isActive: true }];
			runtime.browserUrl = "";
			runtime.browserUrlError = failure === "error" ? new Error("Apple Events denied") : undefined;
			const computer = new MacOSHostComputer({
				appApproval: new AppApprovalStore(["com.apple.Safari"]),
				urlBlocklist: ["*blocked.example*"],
				overlay: NOOP_POINTER_OVERLAY,
			});

			await expect(computer.getAppState(TARGET_PID, { settleMs: 0, requireWindow: true })).rejects.toThrow(
				/browser URL/i,
			);

			expect(childProcessMock.execFile.mock.calls.filter(([file]) => file === "sh")).toHaveLength(0);
			expect(screenshotMock.captureDisplayImage).not.toHaveBeenCalled();
			expect(accessibilityMock.extractAccessibilityTree).not.toHaveBeenCalled();
		},
	);

	it("invalidates an observation when a later capture fails and on close", async () => {
		const computer = approvedComputer();
		await observe(computer);
		runtime.screenshotError = new Error("capture failed");

		await expect(computer.getAppState(TARGET_PID, { settleMs: 0, requireWindow: true })).rejects.toThrow(
			"capture failed",
		);
		expect(computer.getInputObservation(TARGET_PID)).toBeUndefined();

		runtime.screenshotError = undefined;
		await observe(computer);
		await computer.close();
		expect(computer.getInputObservation(TARGET_PID)).toBeUndefined();
		expect(accessibilityMock.releaseAccessibilitySnapshot).toHaveBeenCalledWith(TARGET_PID);
	});
});

describe("MacOSHostComputer preflightInput", () => {
	it("approves an unchanged, approved current context using read-only queries", async () => {
		const computer = approvedComputer();
		const expected = await observe(computer);

		expect(await computer.preflightInput(expected)).toEqual({ ok: true });
	});

	it("rejects approval revoked after the observation", async () => {
		const approval = new AppApprovalStore([BUNDLE_ID]);
		const computer = new MacOSHostComputer({ appApproval: approval, overlay: NOOP_POINTER_OVERLAY });
		const expected = await observe(computer);
		approval.deny(BUNDLE_ID);

		expect(await computer.preflightInput(expected)).toEqual({ ok: false, reason: "app-not-approved" });
	});

	it("re-checks approval after the awaited window query before authorizing", async () => {
		const approval = new AppApprovalStore([BUNDLE_ID]);
		const computer = new MacOSHostComputer({ appApproval: approval, overlay: NOOP_POINTER_OVERLAY });
		const expected = await observe(computer);
		const queryStarted = deferred<void>();
		const windowQuery = deferred<readonly TestWindow[]>();
		windowMock.openWindows.mockImplementationOnce(() => {
			queryStarted.resolve();
			return windowQuery.promise;
		});

		const result = computer.preflightInput(expected);
		await queryStarted.promise;
		approval.deny(BUNDLE_ID);
		windowQuery.resolve([{ id: 99, owner: { processId: TARGET_PID }, bounds: WINDOW_BOUNDS }]);

		expect(await result).toEqual({ ok: false, reason: "app-not-approved" });
	});

	it("re-checks generation after the awaited window query before authorizing", async () => {
		const computer = approvedComputer();
		const expected = await observe(computer);
		const queryStarted = deferred<void>();
		const windowQuery = deferred<readonly TestWindow[]>();
		windowMock.openWindows.mockImplementationOnce(() => {
			queryStarted.resolve();
			return windowQuery.promise;
		});

		const result = computer.preflightInput(expected);
		await queryStarted.promise;
		await observe(computer);
		windowQuery.resolve([{ id: 99, owner: { processId: TARGET_PID }, bounds: WINDOW_BOUNDS }]);

		expect(await result).toEqual({ ok: false, reason: "observation-replaced" });
	});

	it("fails closed when no approval store is configured", async () => {
		const approved = approvedComputer();
		const expected = await observe(approved);
		const unguarded = new MacOSHostComputer({ overlay: NOOP_POINTER_OVERLAY });
		await unguarded.getAppState(TARGET_PID, { settleMs: 0, requireWindow: true });
		const unguardedObservation = unguarded.getInputObservation(TARGET_PID);
		if (unguardedObservation === undefined) {
			throw new Error("expected direct API observation");
		}

		expect(expected.bundleId).toBe(unguardedObservation.bundleId);
		expect(await unguarded.preflightInput(unguardedObservation)).toEqual({
			ok: false,
			reason: "app-not-approved",
		});
	});

	it("rejects when the observed app is no longer frontmost", async () => {
		const computer = approvedComputer();
		const expected = await observe(computer);
		runtime.apps = [{ name: "Finder", bundleId: BUNDLE_ID, pid: TARGET_PID, isActive: false }];

		expect(await computer.preflightInput(expected)).toEqual({ ok: false, reason: "app-not-frontmost" });
	});

	it.each([
		[[], "window-missing"],
		[[{ id: 100, owner: { processId: TARGET_PID }, bounds: WINDOW_BOUNDS }], "window-changed"],
		[
			[{ id: 99, owner: { processId: TARGET_PID }, bounds: { ...WINDOW_BOUNDS, width: 801 } }],
			"window-bounds-changed",
		],
	] as const)("rejects changed window context with %s", async (windows, reason) => {
		const computer = approvedComputer();
		const expected = await observe(computer);
		windowMock.openWindows.mockResolvedValue(windows);

		expect(await computer.preflightInput(expected)).toEqual({ ok: false, reason });
	});

	it("rejects a URL that becomes blocked after observation", async () => {
		runtime.apps = [{ name: "Safari", bundleId: "com.apple.Safari", pid: TARGET_PID, isActive: true }];
		const approval = new AppApprovalStore(["com.apple.Safari"]);
		const computer = new MacOSHostComputer({
			appApproval: approval,
			urlBlocklist: ["*blocked.example*"],
			overlay: NOOP_POINTER_OVERLAY,
		});
		const expected = await observe(computer);
		runtime.browserUrl = "https://blocked.example/account";

		expect(await computer.preflightInput(expected)).toEqual({ ok: false, reason: "url-blocked" });
	});

	it("fails closed when a configured browser URL cannot be queried", async () => {
		runtime.apps = [{ name: "Safari", bundleId: "com.apple.Safari", pid: TARGET_PID, isActive: true }];
		const computer = new MacOSHostComputer({
			appApproval: new AppApprovalStore(["com.apple.Safari"]),
			urlBlocklist: ["*blocked.example*"],
			overlay: NOOP_POINTER_OVERLAY,
		});
		const expected = await observe(computer);
		runtime.browserUrlError = new Error("Apple Events denied");

		expect(await computer.preflightInput(expected)).toEqual({ ok: false, reason: "url-unavailable" });
	});

	it("rejects an observation replaced by a newer successful read", async () => {
		const computer = approvedComputer();
		const replaced = await observe(computer);
		await observe(computer);

		expect(await computer.preflightInput(replaced)).toEqual({ ok: false, reason: "observation-replaced" });
	});

	it("does not capture, extract AX, or rebind the remembered target while checking", async () => {
		const computer = approvedComputer();
		const expected = await observe(computer);
		const screenshotReads = childProcessMock.execFile.mock.calls.filter(([file]) => file === "sh").length;
		const axReads = accessibilityMock.extractAccessibilityTree.mock.calls.length;
		const rememberTargetWindow = vi.spyOn(computer, "rememberTargetWindow");

		await computer.preflightInput(expected);

		expect(childProcessMock.execFile.mock.calls.filter(([file]) => file === "sh")).toHaveLength(screenshotReads);
		expect(screenshotMock.captureDisplayImage).not.toHaveBeenCalled();
		expect(accessibilityMock.extractAccessibilityTree).toHaveBeenCalledTimes(axReads);
		expect(rememberTargetWindow).not.toHaveBeenCalled();
	});
});
