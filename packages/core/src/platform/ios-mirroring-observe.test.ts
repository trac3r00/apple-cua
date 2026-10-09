import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputInterrupted } from "../computer/input-scope.js";

const native = vi.hoisted(() => ({
	findRunningApplication: vi.fn(),
	listWindows: vi.fn(),
	captureWindowPng: vi.fn(),
	recognizeTextInImage: vi.fn(),
	getRunningApplications: vi.fn(),
	activateApplication: vi.fn(),
	listTopLevelWindows: vi.fn(),
	scroll: vi.fn(),
	windowTitlesForPid: vi.fn(),
}));

vi.mock("./macos-ffi/workspace.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./macos-ffi/workspace.js")>()),
	findRunningApplication: native.findRunningApplication,
	getRunningApplications: native.getRunningApplications,
	activateApplication: native.activateApplication,
}));
vi.mock("./macos-top-level-windows.js", () => ({ listTopLevelWindows: native.listTopLevelWindows }));
vi.mock("./ios-input.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./ios-input.js")>()),
	scrollMirroring: native.scroll,
}));
vi.mock("./macos-ffi/window-list.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./macos-ffi/window-list.js")>()),
	listWindows: native.listWindows,
}));
vi.mock("./macos-ffi/accessibility.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./macos-ffi/accessibility.js")>()),
	windowTitlesForPid: native.windowTitlesForPid,
	createApplicationElement: vi.fn(() => {
		throw new Error("no accessibility in tests");
	}),
}));
vi.mock("./macos-ffi/screenshot.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./macos-ffi/screenshot.js")>()),
	captureWindowPng: native.captureWindowPng,
}));
vi.mock("./macos-ffi/vision.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("./macos-ffi/vision.js")>()),
	readImagePixelSize: vi.fn(() => ({ width: 600, height: 1200 })),
	recognizeTextInImage: native.recognizeTextInImage,
}));

import { IPhoneMirroring } from "./ios-mirroring.js";

const PID = 9001;
const BOUNDS = { x: 100, y: 200, width: 300, height: 600 };

function showPhoneWindow(): void {
	native.findRunningApplication.mockReturnValue({
		name: "iPhone Mirroring",
		bundleId: "com.apple.ScreenContinuity",
		pid: PID,
		isActive: true,
		path: "/System/Applications/iPhone Mirroring.app",
	});
	native.listWindows.mockReturnValue([
		{ id: 5, ownerPid: PID, layer: 0, ownerName: "iPhone Mirroring", title: "iPhone Mirroring", bounds: BOUNDS },
	]);
}

function ocr(text: string, confidence: number): unknown {
	return { text, confidence, box: { x: 60, y: 120, width: 120, height: 40 } };
}

beforeEach(() => {
	vi.clearAllMocks();
	native.captureWindowPng.mockReturnValue({ data: Buffer.from("png") });
	native.windowTitlesForPid.mockReturnValue(new Map());
});

describe("#given a connected phone with auxiliary windows #when observing #then capture only its accessible window", () => {
	it.each([
		{ onScreen: false, bounds: BOUNDS },
		{ onScreen: true, bounds: { x: 12, y: 300, width: 38, height: 130 } },
	])("ignores auxiliary and hidden welcome windows with onScreen=$onScreen", async ({ onScreen, bounds }) => {
		showPhoneWindow();
		native.windowTitlesForPid.mockReturnValue(new Map([[5, "iPhone Mirroring"]]));
		const windows = [
			{
				id: 99,
				ownerPid: PID,
				layer: 0,
				ownerName: "iPhone Mirroring",
				title: "",
				bounds: { x: 0, y: 0, width: 2560, height: 30 },
			},
			{
				id: 98,
				ownerPid: PID,
				layer: 0,
				ownerName: "iPhone Mirroring",
				title: "Welcome to iPhone Mirroring",
				bounds: { x: 3520, y: 405, width: 640, height: 662 },
			},
			{ id: 5, ownerPid: PID, layer: 0, ownerName: "iPhone Mirroring", title: "", bounds },
		];
		native.listWindows.mockImplementation((options: { readonly onScreenOnly: boolean }) =>
			options.onScreenOnly && !onScreen ? [] : windows,
		);
		native.captureWindowPng.mockImplementation((id: number) => {
			if (id !== 5) {
				throw new Error("Auxiliary window cannot be captured");
			}
			return { data: Buffer.from("png") };
		});
		native.recognizeTextInImage.mockReturnValue([ocr("Settings", 1)]);

		const observation = await new IPhoneMirroring().observe();

		expect(observation.window.id).toBe(5);
		expect(observation.state).toBe("ready");
		expect(observation.texts.map((entry) => entry.text)).toEqual(["Settings"]);
	});
});

describe("#given interrupted phone scrolling #when restoring focus #then preserve the human's intervening choice", () => {
	it("does not reactivate an old app after the human has focused another app", async () => {
		showPhoneWindow();
		native.recognizeTextInImage.mockReturnValue([ocr("Settings", 1)]);
		native.getRunningApplications.mockReturnValue([{ pid: 101, isActive: true }]);
		native.listTopLevelWindows.mockImplementation(async () => {
			native.getRunningApplications.mockReturnValue([{ pid: 202, isActive: true }]);
			return [{ id: 5, ownerPid: PID, ownerName: "iPhone Mirroring", title: "", bounds: BOUNDS }];
		});
		native.scroll.mockRejectedValue(new InputInterrupted("stopped"));

		await expect(new IPhoneMirroring().scroll("down", { borrowPointer: true })).rejects.toThrow(InputInterrupted);

		expect(native.activateApplication).not.toHaveBeenCalled();
	});

	it("restores the original app when the phone still owns foreground focus", async () => {
		showPhoneWindow();
		native.recognizeTextInImage.mockReturnValue([ocr("Settings", 1)]);
		native.getRunningApplications.mockReturnValue([{ pid: 101, isActive: true }]);
		native.listTopLevelWindows.mockResolvedValue([
			{ id: 5, ownerPid: PID, ownerName: "iPhone Mirroring", title: "", bounds: BOUNDS },
		]);
		native.scroll.mockImplementation(async () => {
			native.getRunningApplications.mockReturnValue([{ pid: PID, isActive: true }]);
			throw new InputInterrupted("stopped");
		});

		await expect(new IPhoneMirroring().scroll("down", { borrowPointer: true })).rejects.toThrow(InputInterrupted);

		expect(native.activateApplication).toHaveBeenCalledTimes(1);
		expect(native.activateApplication).toHaveBeenCalledWith(101);
	});
});

describe("#given a ready phone #when IPhoneMirroring observes #then it captures and reads the screen exactly once", () => {
	it("performs a single capture and a single OCR pass and returns the mapped texts", async () => {
		showPhoneWindow();
		native.recognizeTextInImage.mockReturnValue([ocr("Settings", 1)]);

		const observation = await new IPhoneMirroring().observe();

		expect(native.captureWindowPng).toHaveBeenCalledTimes(1);
		expect(native.recognizeTextInImage).toHaveBeenCalledTimes(1);
		expect(observation.state).toBe("ready");
		expect(observation.texts.map((entry) => entry.text)).toEqual(["Settings"]);
	});

	it("keeps OCR accuracy by dropping only the texts below the requested confidence", async () => {
		showPhoneWindow();
		native.recognizeTextInImage.mockReturnValue([ocr("Sharp", 0.95), ocr("Smudge", 0.4)]);

		const observation = await new IPhoneMirroring({ minimumConfidence: 0.9 }).observe();

		expect(native.captureWindowPng).toHaveBeenCalledTimes(1);
		expect(observation.texts.map((entry) => entry.text)).toEqual(["Sharp"]);
	});
});

describe("#given an interstitial #when IPhoneMirroring observes #then it refuses after one pass, even with a high confidence floor", () => {
	it("refuses a blocked session whose marker is below the requested confidence", async () => {
		showPhoneWindow();
		native.recognizeTextInImage.mockReturnValue([ocr("Mirroring ended", 0.3)]);

		await expect(new IPhoneMirroring({ minimumConfidence: 0.9 }).observe()).rejects.toThrow(/Mirroring ended/);

		expect(native.captureWindowPng).toHaveBeenCalledTimes(1);
		expect(native.recognizeTextInImage).toHaveBeenCalledTimes(1);
	});
});

describe("#given no usable phone #when IPhoneMirroring observes #then it refuses without capturing", () => {
	it("refuses when the app is not running", async () => {
		native.findRunningApplication.mockReturnValue(undefined);

		await expect(new IPhoneMirroring().observe()).rejects.toThrow(/isn't running/);

		expect(native.captureWindowPng).not.toHaveBeenCalled();
	});

	it("refuses when the app runs without a phone window", async () => {
		showPhoneWindow();
		native.listWindows.mockReturnValue([]);

		await expect(new IPhoneMirroring().observe()).rejects.toThrow(/no phone is connected/);

		expect(native.captureWindowPng).not.toHaveBeenCalled();
	});
});
