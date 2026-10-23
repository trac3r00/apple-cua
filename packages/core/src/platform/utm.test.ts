import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
const native = vi.hoisted(() => ({
	execFile:
		vi.fn<
			(file: string, args: readonly string[], options: { timeout: number; maxBuffer: number }, cb: Callback) => void
		>(),
	status: vi.fn(() => ({ stopped: false })),
}));
vi.mock("node:child_process", () => ({ execFile: native.execFile }));
vi.mock("./stop-switch.js", () => ({
	StopSwitch: class {
		status = native.status;
	},
	describeUserStop: () => "stopped",
}));

import { runInInputScope } from "../computer/input-scope.js";
import { UTM, UTMError, type UTMObservation } from "./utm.js";

const id = "vm-123";
const guest = {
	id: () => id,
	name: () => 'Windows "test"',
	status: () => "started",
	backend: () => "qemu",
};
const application = {
	virtualMachines: () => [guest],
	windows: () => [{ name: () => guest.name(), id: () => 77 }],
	inputKeystroke: vi.fn(),
	inputScanCode: vi.fn(),
	inputMouseClick: vi.fn(),
	stop: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
	native.execFile.mockImplementation((_file, args, _options, callback) => {
		const source = args[3];
		if (source === undefined) throw new Error("Missing JXA source");
		try {
			const output: unknown = runInNewContext(`${source}; run();`, { Application: () => application });
			callback(null, output === undefined ? "" : String(output), "");
		} catch (error) {
			callback(new Error(String(error)), "", "");
		}
	});
});

describe("#given UTM scripting #when a VM is selected #then only its exact identity receives input", () => {
	it("parses inventory through the script boundary", async () => {
		expect(await new UTM().list()).toEqual([{ id, name: 'Windows "test"', status: "started", backend: "qemu" }]);
	});

	it("encodes quotes and newlines as guest make/break pairs", async () => {
		await new UTM().type('Windows "test"', 'a"\n');
		expect(application.inputScanCode.mock.calls).toEqual([
			[guest, { codes: [30, 158] }],
			[guest, { codes: [42, 40, 168, 170] }],
			[guest, { codes: [28, 156] }],
		]);
	});

	it("encodes a complete guest key press and release", async () => {
		await new UTM().key(id, "ctrl+a");
		expect(application.inputScanCode).toHaveBeenCalledWith(guest, { codes: [29, 30, 158, 157] });
	});

	it("sends one Enter for a Windows CRLF newline", async () => {
		await new UTM().type(id, "\r\n");
		expect(application.inputScanCode).toHaveBeenCalledTimes(1);
		expect(application.inputScanCode).toHaveBeenCalledWith(guest, { codes: [28, 156] });
	});

	it("treats a blank app path as default", () => {
		expect(new UTM({ appPath: " " }).appPath).toMatch(/UTM\.app$/u);
	});

	it("routes guest pixels and monitor without using host pointer input", async () => {
		await new UTM().click(id, { x: 240, y: 150 }, { button: "right", monitor: 2 });
		expect(application.inputMouseClick).toHaveBeenCalledWith(guest, {
			at: [240, 150],
			to: 2,
			withMouseButton: "right",
		});
	});

	it("refuses an unknown VM without dispatching input", async () => {
		await expect(new UTM().type("missing", "hello")).rejects.toThrow();
		expect(application.inputScanCode).not.toHaveBeenCalled();
	});

	it("uses graceful shutdown rather than default power off", async () => {
		await new UTM().stop(id);
		expect(application.stop).toHaveBeenCalledWith(guest, { by: "request" });
	});

	it("refuses non-ASCII input before launching a script", async () => {
		await expect(new UTM().type(id, "한글")).rejects.toThrow(UTMError);
		expect(native.execFile).not.toHaveBeenCalled();
	});

	it("refuses fractional guest pixels before launching a script", async () => {
		await expect(new UTM().click(id, { x: 0.5, y: 1 })).rejects.toThrow(UTMError);
		expect(native.execFile).not.toHaveBeenCalled();
	});

	it("refuses Apple Virtualization input without dispatching", async () => {
		const backend = vi.spyOn(guest, "backend").mockReturnValue("apple");
		try {
			await expect(new UTM().type(id, "hello")).rejects.toThrow();
			expect(application.inputScanCode).not.toHaveBeenCalled();
		} finally {
			backend.mockRestore();
		}
	});

	it("honors an interrupted input scope before launching a script", async () => {
		await expect(
			runInInputScope({ interruption: () => "cancelled" }, async () => await new UTM().key(id, "enter")),
		).rejects.toThrow("cancelled");
		expect(native.execFile).not.toHaveBeenCalled();
	});

	it("refuses image clicks when the observed screen changed", async () => {
		const computer = new UTM();
		const observation: UTMObservation = {
			image: { data: Buffer.from("png"), mimeType: "image/png", width: 800, height: 640 },
			displayRect: { x: 0, y: 40, width: 800, height: 600 },
			windowId: 42,
			guestSize: { width: 800, height: 600 },
			texts: [{ text: "Save", confidence: 1, box: { x: 10, y: 10, width: 40, height: 20 } }],
		};
		vi.spyOn(computer, "observe").mockResolvedValue({ ...observation, texts: [] });
		const click = vi.spyOn(computer, "click").mockResolvedValue();
		await expect(computer.clickObserved(id, { x: 20, y: 60 }, observation)).rejects.toThrow("screen content changed");
		expect(click).not.toHaveBeenCalled();
	});

	it("refuses a same-label target that moved", async () => {
		const computer = new UTM();
		const observation: UTMObservation = {
			image: { data: Buffer.from("png"), mimeType: "image/png", width: 800, height: 640 },
			displayRect: { x: 0, y: 40, width: 800, height: 600 },
			windowId: 42,
			guestSize: { width: 800, height: 600 },
			texts: [{ text: "Save", confidence: 1, box: { x: 10, y: 10, width: 40, height: 20 } }],
		};
		vi.spyOn(computer, "observe").mockResolvedValue({
			...observation,
			texts: [{ text: "Save", confidence: 1, box: { x: 300, y: 300, width: 40, height: 20 } }],
		});
		const click = vi.spyOn(computer, "click").mockResolvedValue();
		await expect(computer.clickObserved(id, { x: 20, y: 60 }, observation)).rejects.toThrow("screen content changed");
		expect(click).not.toHaveBeenCalled();
	});

	it("refuses changed non-text image content even with empty OCR", async () => {
		const computer = new UTM();
		const observation: UTMObservation = {
			image: { data: Buffer.from("before"), mimeType: "image/png", width: 800, height: 640 },
			displayRect: { x: 0, y: 40, width: 800, height: 600 },
			windowId: 42,
			guestSize: { width: 800, height: 600 },
			texts: [],
		};
		vi.spyOn(computer, "observe").mockResolvedValue({
			...observation,
			image: { ...observation.image, data: Buffer.from("after") },
		});
		const click = vi.spyOn(computer, "click").mockResolvedValue();
		await expect(computer.clickObserved(id, { x: 20, y: 60 }, observation)).rejects.toThrow("screen content changed");
		expect(click).not.toHaveBeenCalled();
	});

	it("refuses duplicate VM names even when only one matching window is open", async () => {
		const inventory = vi
			.spyOn(application, "virtualMachines")
			.mockReturnValue([guest, { ...guest, id: () => "vm-other" }]);
		try {
			await expect(new UTM().screenshot(id)).rejects.toThrow("window name is ambiguous");
		} finally {
			inventory.mockRestore();
		}
	});
});
