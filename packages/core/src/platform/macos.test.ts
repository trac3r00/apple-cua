import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type ExecFileMock = (
	file: string,
	args: readonly string[],
	options: { readonly encoding?: BufferEncoding; readonly timeout?: number },
	callback: ExecFileCallback,
) => void;

const childProcessMock = vi.hoisted(() => ({
	execFile: vi.fn<ExecFileMock>(),
}));

vi.mock("node:child_process", () => ({
	execFile: childProcessMock.execFile,
}));

import { getMacOSLogicalScreenSize, parsePngDimensions, parseSystemProfilerLogicalScreenSize } from "./macos.js";

function createFakePng(): Buffer {
	const data = globalThis.Buffer.alloc(24);
	data.write("\u0089PNG\r\n\u001a\n", 0, "latin1");
	data.writeUInt32BE(1920, 16);
	data.writeUInt32BE(1080, 20);
	return data;
}

beforeEach(() => {
	childProcessMock.execFile.mockReset();
});

function mockExecFileStdout(stdout: string): void {
	childProcessMock.execFile.mockImplementationOnce((file, args, options, callback) => {
		void file;
		void args;
		void options;
		callback(null, stdout, "");
	});
}

function mockExecFileError(error: Error): void {
	childProcessMock.execFile.mockImplementationOnce((file, args, options, callback) => {
		void file;
		void args;
		void options;
		callback(error, "", "");
	});
}

describe("#given macos screenshot capture returns a png buffer", () => {
	describe("#when dimensions are parsed from the screenshot bytes", () => {
		it("#then parses dimensions from the png IHDR chunk", async () => {
			const fakePng = createFakePng();

			const result = parsePngDimensions(fakePng);

			expect(result.width).toBe(1920);
			expect(result.height).toBe(1080);
		});
	});
});

describe("#given Finder desktop bounds #when resolving macOS screen size #then logical points are returned", () => {
	it("uses osascript bounds before system_profiler", async () => {
		mockExecFileStdout("0, 0, 1512, 982\n");

		const size = await getMacOSLogicalScreenSize();

		expect(size).toEqual({ width: 1512, height: 982 });
		expect(childProcessMock.execFile).toHaveBeenCalledTimes(1);
		expect(childProcessMock.execFile).toHaveBeenCalledWith(
			"osascript",
			["-e", 'tell application "Finder" to get bounds of window of desktop'],
			expect.objectContaining({ timeout: 2000 }),
			expect.any(Function),
		);
	});
});

describe("#given Finder bounds fail #when resolving macOS screen size #then system_profiler UI Looks like is used", () => {
	it("falls back to logical display metadata", async () => {
		mockExecFileError(new Error("Automation permission denied"));
		mockExecFileStdout(`
Graphics/Displays:
    Displays:
        Built-in Liquid Retina Display:
          Resolution: 3024 x 1964 Retina
          UI Looks like: 1512 x 982 @ 2x
`);

		const size = await getMacOSLogicalScreenSize();

		expect(size).toEqual({ width: 1512, height: 982 });
		expect(childProcessMock.execFile).toHaveBeenCalledTimes(2);
		expect(childProcessMock.execFile).toHaveBeenLastCalledWith(
			"system_profiler",
			["SPDisplaysDataType"],
			expect.objectContaining({ timeout: 10_000 }),
			expect.any(Function),
		);
	});
});

describe("#given Retina system_profiler without UI Looks like #when resolving screen size #then physical pixels are halved", () => {
	it("uses the Retina scale heuristic", async () => {
		mockExecFileError(new Error("osascript timeout"));
		mockExecFileStdout("Resolution: 5120 x 2880 Retina\n");

		const size = await getMacOSLogicalScreenSize();

		expect(size).toEqual({ width: 2560, height: 1440 });
	});
});

describe("#given a non-Retina system_profiler resolution #when parsing logical size #then returns it unchanged", () => {
	it("keeps non-Retina dimensions", () => {
		const size = parseSystemProfilerLogicalScreenSize("Resolution: 1920 x 1080\n");

		expect(size).toEqual({ width: 1920, height: 1080 });
	});
});
