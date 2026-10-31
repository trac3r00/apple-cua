import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";
import type { AXTreeElement, AppState } from "../accessibility/types.js";
import type { AppStateOptions, Rect, Size } from "../types/index.js";
import type { OcrTextObservation, RecognizeTextOptions } from "./macos-ffi/vision.js";
import type { WorkspaceRunningApplication } from "./macos-ffi/workspace.js";

const native = vi.hoisted(() => ({
	findRunningApplication: vi.fn<(bundleId: string) => WorkspaceRunningApplication | undefined>(),
	getAppState: vi.fn<(pid: number, options: AppStateOptions) => Promise<AppState>>(),
	close: vi.fn<() => Promise<void>>(),
	recognizeTextInImage: vi.fn<(data: Buffer, options: RecognizeTextOptions) => readonly OcrTextObservation[]>(),
}));

vi.mock("./macos-ffi/workspace.js", () => ({ findRunningApplication: native.findRunningApplication }));
vi.mock("./macos.js", () => ({
	MacOSHostComputer: class {
		getAppState = native.getAppState;
		close = native.close;
	},
}));
vi.mock("./macos-ffi/vision.js", () => ({ recognizeTextInImage: native.recognizeTextInImage }));

const { captureUtmDisplay, mapGuestPoint, mapUtmPoint } = await import("./utm-visual.js");

const displayRect: Rect = { x: 40, y: 80, width: 1200, height: 800 };
const guestSize: Size = { width: 1600, height: 900 };
const data = Buffer.from("exact-window-image");

function state(): AppState {
	return {
		app: "UTM",
		bundleId: "com.utmapp.UTM",
		pid: 321,
		frontmost: false,
		axAvailable: true,
		windowId: 42,
		windowBounds: { x: 200, y: 300, width: 640, height: 460 },
		elements: [group(displayRect)],
		screenshotBase64: data.toString("base64"),
		screenshotWidth: 1280,
		screenshotHeight: 920,
		screenshotMimeType: "image/jpeg",
		display: { width: 2000, height: 1200, scaleFactor: 2 },
	};
}

function group(frame: Rect): AXTreeElement {
	return { id: 1, role: "AXGroup", label: "Virtual Machine", value: null, frame, actions: [], children: [] };
}

beforeEach(() => {
	vi.resetAllMocks();
	native.findRunningApplication.mockReturnValue({
		name: "UTM",
		bundleId: "com.utmapp.UTM",
		pid: 321,
		path: "/Applications/UTM.app",
		isActive: false,
	});
	native.getAppState.mockResolvedValue(state());
	native.close.mockResolvedValue();
	native.recognizeTextInImage.mockReturnValue([]);
});

describe("#given UTM image geometry #when mapping points #then guest pixels exclude chrome and letterboxes", () => {
	it("removes nonzero chrome and scales screenshot pixels", () => {
		expect(mapUtmPoint({ x: 640, y: 480 }, displayRect, { width: 600, height: 400 })).toEqual({
			x: 300,
			y: 200,
		});
	});

	it.each([
		{ rect: displayRect, size: guestSize, image: { x: 340, y: 292.5 }, guest: { x: 400, y: 200 } },
		{
			rect: { x: 30, y: 90, width: 1200, height: 600 },
			size: { width: 800, height: 800 },
			image: { x: 480, y: 240 },
			guest: { x: 200, y: 200 },
		},
	])("inverts scaled coordinates with centered letterboxing: $rect", ({ rect, size, image, guest }) => {
		expect(mapUtmPoint(image, rect, size)).toEqual(guest);
		expect(mapGuestPoint(guest, rect, size)).toEqual(image);
	});

	it.each([
		{ x: 40, y: 100 },
		{ x: 40, y: 850 },
		{ x: 39, y: 480 },
		{ x: 1240, y: 480 },
		{ x: 640, y: 817.5 },
		{ x: Number.NaN, y: 480 },
		{ x: 640, y: Number.POSITIVE_INFINITY },
	])("refuses chrome, horizontal letterboxing, and outside points: %j", (point) => {
		expect(() => mapUtmPoint(point, displayRect, guestSize)).toThrow(RangeError);
	});

	it("refuses vertical letterboxing", () => {
		expect(() =>
			mapUtmPoint({ x: 100, y: 300 }, { x: 30, y: 90, width: 1200, height: 600 }, { width: 800, height: 800 }),
		).toThrow(RangeError);
	});

	it.each([
		{ x: -1, y: 0 },
		{ x: 1600, y: 0 },
		{ x: 0, y: 900 },
		{ x: 0, y: Number.NaN },
	])("refuses invalid guest points: %j", (point) => {
		expect(() => mapGuestPoint(point, displayRect, guestSize)).toThrow(RangeError);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses invalid dimensions: %s", (dimension) => {
		for (const field of ["width", "height"] as const) {
			expect(() => mapUtmPoint({ x: 100, y: 200 }, { ...displayRect, [field]: dimension }, guestSize)).toThrow(
				RangeError,
			);
			expect(() => mapGuestPoint({ x: 0, y: 0 }, displayRect, { ...guestSize, [field]: dimension })).toThrow(
				RangeError,
			);
		}
	});
});

describe("#given an exact UTM window #when capturing #then only its display is recognized", () => {
	it("reuses the full host image and transforms region OCR into guest space", async () => {
		native.recognizeTextInImage.mockReturnValue([
			{ text: "Guest", confidence: 0.9, box: { x: 340, y: 292.5, width: 150, height: 30 } },
			{ text: "Letterbox", confidence: 1, box: { x: 40, y: 80, width: 100, height: 20 } },
			{ text: "Edge", confidence: 0.8, box: { x: 25, y: 130, width: 30, height: 30 } },
		]);
		const result = await captureUtmDisplay(42, guestSize);
		expect(native.findRunningApplication).toHaveBeenCalledWith("com.utmapp.UTM");
		expect(native.getAppState).toHaveBeenCalledTimes(1);
		expect(native.getAppState).toHaveBeenCalledWith(
			321,
			expect.objectContaining({ windowId: 42, requireWindow: true, includeScreenshot: true, diffOnly: false }),
		);
		expect(native.recognizeTextInImage).toHaveBeenCalledTimes(1);
		expect(native.recognizeTextInImage).toHaveBeenCalledWith(data, { region: displayRect });
		expect(result).toEqual({
			image: { data, width: 1280, height: 920, mimeType: "image/jpeg" },
			displayRect,
			windowId: 42,
			texts: [
				{ text: "Guest", confidence: 0.9, box: { x: 400, y: 200, width: 200, height: 40 } },
				{ text: "Edge", confidence: 0.8, box: { x: 0, y: 0, width: 20, height: 70 / 3 } },
			],
		});
		expect(native.close).toHaveBeenCalledTimes(1);
	});

	it.each<Partial<ReturnType<typeof state>>>([
		{ windowId: 43 },
		{ pid: 999 },
		{ screenshotBase64: "" },
		{ elements: [] },
		{ elements: [group(displayRect), group(displayRect)] },
		{ elements: [group({ ...displayRect, width: 0 })] },
		{ elements: [group({ ...displayRect, x: -10 })] },
		{ elements: [group({ ...displayRect, width: 2000 })] },
	])("refuses unavailable or mismatched exact-window observations: %j", async (override) => {
		native.getAppState.mockResolvedValue({ ...state(), ...override });
		await expect(captureUtmDisplay(42, guestSize)).rejects.toThrow();
		expect(native.getAppState).toHaveBeenCalledTimes(1);
		expect(native.recognizeTextInImage).not.toHaveBeenCalled();
		expect(native.close).toHaveBeenCalledTimes(1);
	});

	it("closes host resources when exact-window capture fails", async () => {
		native.getAppState.mockRejectedValue(new Error("Window not found"));
		await expect(captureUtmDisplay(42, guestSize)).rejects.toThrow("Window not found");
		expect(native.getAppState).toHaveBeenCalledTimes(1);
		expect(native.close).toHaveBeenCalledTimes(1);
	});

	it("refuses a missing UTM process without attempting a capture", async () => {
		native.findRunningApplication.mockReturnValue(undefined);
		await expect(captureUtmDisplay(42, guestSize)).rejects.toThrow("UTM is not running");
		expect(native.getAppState).not.toHaveBeenCalled();
	});

	it.each([0, -1, 1.5, Number.NaN])("refuses invalid window identifiers before native lookup: %s", async (id) => {
		await expect(captureUtmDisplay(id, guestSize)).rejects.toThrow(RangeError);
		expect(native.findRunningApplication).not.toHaveBeenCalled();
	});

	it("refuses invalid guest dimensions before native lookup", async () => {
		await expect(captureUtmDisplay(42, { width: 0, height: 900 })).rejects.toThrow(RangeError);
		expect(native.findRunningApplication).not.toHaveBeenCalled();
	});
});
