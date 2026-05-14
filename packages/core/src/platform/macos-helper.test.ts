import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
	existsSync: vi.fn(() => true),
	spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: nativeMocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: nativeMocks.existsSync }));

class FakeHelperProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	killed = false;

	constructor() {
		super();
		this.stdin.setEncoding("utf8");
		this.stdout.setEncoding("utf8");
		this.stderr.setEncoding("utf8");
	}

	kill(signal?: NodeJS.Signals): boolean {
		this.killed = true;
		this.emit("close", 0, signal ?? null);
		return true;
	}

	crash(): void {
		this.emit("close", 1, null);
	}
}

describe("#given MacOSCuaHelper JSON stdio protocol", () => {
	beforeEach(() => {
		nativeMocks.existsSync.mockReturnValue(true);
		nativeMocks.spawn.mockReset();
	});

	it("#when sending a click request #then writes a line-delimited JSON command and resolves matching response", async () => {
		// given
		const child = new FakeHelperProcess();
		nativeMocks.spawn.mockReturnValueOnce(child);
		const { MacOSCuaHelper } = await import("./macos-helper.js");
		const helper = new MacOSCuaHelper({ binaryPath: "/tmp/cua-helper" });

		// when
		const writtenLine = nextWrittenLine(child.stdin);
		const request = helper.clickPid(1234, { x: 500, y: 300 });
		const payload = requestPayload(await writtenLine);

		// then
		expect(payload).toMatchObject({ cmd: "click", pid: 1234, x: 500, y: 300, button: "left", count: 1 });
		writeResponse(child, { id: payload.id, ok: true });
		await expect(request).resolves.toBeUndefined();
		helper.close();
	});

	it("#when responses arrive out of order #then each request resolves by id", async () => {
		// given
		const child = new FakeHelperProcess();
		nativeMocks.spawn.mockReturnValueOnce(child);
		const { MacOSCuaHelper } = await import("./macos-helper.js");
		const helper = new MacOSCuaHelper({ binaryPath: "/tmp/cua-helper" });

		// when
		const writtenLines = nextWrittenLines(child.stdin, 2);
		const first = helper.ping();
		const second = helper.cursorPosition();
		const [firstPayload, secondPayload] = (await writtenLines).map(requestPayload);

		// then
		writeResponse(child, { id: secondPayload.id, ok: true, x: 10.2, y: 20.7 });
		writeResponse(child, { id: firstPayload.id, ok: true });
		await expect(first).resolves.toBeUndefined();
		await expect(second).resolves.toEqual({ x: 10, y: 21 });
		helper.close();
	});

	it("#when requesting logical screen size #then writes screen_size_logical and returns rounded dimensions", async () => {
		// given
		const child = new FakeHelperProcess();
		nativeMocks.spawn.mockReturnValueOnce(child);
		const { MacOSCuaHelper } = await import("./macos-helper.js");
		const helper = new MacOSCuaHelper({ binaryPath: "/tmp/cua-helper" });

		// when
		const writtenLine = nextWrittenLine(child.stdin);
		const request = helper.getLogicalScreenSize();
		const payload = requestPayload(await writtenLine);

		// then
		expect(payload).toMatchObject({ cmd: "screen_size_logical" });
		writeResponse(child, { id: payload.id, ok: true, x: 2559.7, y: 1440.2 });
		await expect(request).resolves.toEqual({ width: 2560, height: 1440 });
		helper.close();
	});

	it("#when helper returns an error #then rejects with the helper message", async () => {
		// given
		const child = new FakeHelperProcess();
		nativeMocks.spawn.mockReturnValueOnce(child);
		const { MacOSCuaHelper, MacOSCuaHelperError } = await import("./macos-helper.js");
		const helper = new MacOSCuaHelper({ binaryPath: "/tmp/cua-helper" });

		// when
		const writtenLine = nextWrittenLine(child.stdin);
		const request = helper.ping();
		const payload = requestPayload(await writtenLine);
		writeResponse(child, { id: payload.id, ok: false, error: "boom" });

		// then
		await expect(request).rejects.toBeInstanceOf(MacOSCuaHelperError);
		await expect(request).rejects.toThrow("boom");
		helper.close();
	});

	it("#when the helper crashes before replying #then restarts and retries the request", async () => {
		// given
		const firstChild = new FakeHelperProcess();
		const secondChild = new FakeHelperProcess();
		nativeMocks.spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
		const { MacOSCuaHelper } = await import("./macos-helper.js");
		const helper = new MacOSCuaHelper({ binaryPath: "/tmp/cua-helper" });

		// when
		const firstWrite = nextWrittenLine(firstChild.stdin);
		const secondWrite = nextWrittenLine(secondChild.stdin);
		const request = helper.ping();
		await firstWrite;
		firstChild.crash();
		const retryPayload = requestPayload(await secondWrite);
		writeResponse(secondChild, { id: retryPayload.id, ok: true });

		// then
		await expect(request).resolves.toBeUndefined();
		expect(nativeMocks.spawn).toHaveBeenCalledTimes(2);
		helper.close();
	});
});

async function nextWrittenLine(stream: PassThrough): Promise<string> {
	const lines = await nextWrittenLines(stream, 1);
	const [line] = lines;
	if (line === undefined) {
		throw new Error("expected one written line");
	}
	return line;
}

function nextWrittenLines(stream: PassThrough, count: number): Promise<string[]> {
	return new Promise((resolve) => {
		const lines: string[] = [];
		let buffer = "";
		stream.on("data", function onData(chunk: string | Buffer) {
			buffer += String(chunk);
			while (true) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) {
					break;
				}
				lines.push(buffer.slice(0, newlineIndex));
				buffer = buffer.slice(newlineIndex + 1);
				if (lines.length === count) {
					stream.off("data", onData);
					resolve(lines);
					return;
				}
			}
		});
	});
}

function requestPayload(line: string): { id: string; cmd: string; [key: string]: unknown } {
	const parsed: unknown = JSON.parse(line);
	if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.cmd !== "string") {
		throw new Error("invalid request payload");
	}
	return { ...parsed, id: parsed.id, cmd: parsed.cmd };
}

function writeResponse(
	child: FakeHelperProcess,
	response: { id: string; ok: boolean; error?: string; x?: number; y?: number },
): void {
	child.stdout.write(`${JSON.stringify(response)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
