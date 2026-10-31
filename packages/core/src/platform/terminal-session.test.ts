import { describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";
import {
	TerminalAutomationPermissionError,
	TerminalNotRunningError,
	createTerminalSession,
} from "./terminal-session.js";

const terminal = { pid: 4242, bundleId: "com.apple.Terminal" };

function setup() {
	const run = vi.fn<(script: string) => Promise<number | undefined>>(async () => 91);
	const read = vi.fn<(pid: number, windowId?: number) => string>(() => "");
	const session = createTerminalSession({ find: () => terminal, run, read });
	return { session, run, read };
}

describe("createTerminalSession", () => {
	it("#given a command with quotes, slashes, and newlines #when dispatched #then AppleScript receives one safely escaped argument", async () => {
		const { session, run } = setup();
		await session.runCommand({ command: `printf "a\\\\b"\necho done` });
		const dispatch = run.mock.calls[0]?.[0] ?? "";
		expect(run).toHaveBeenCalledTimes(2);
		expect(dispatch).toContain("ignoring application responses");
		expect(run.mock.calls[0]?.[0]).toContain(`printf \\"a\\\\\\\\b\\"\\necho done`);
	});

	it("#given Terminal.app is absent #when located #then a clear not-running error is returned", () => {
		const session = createTerminalSession({ find: () => undefined, run: async () => undefined, read: () => "" });
		expect(() => session.findTerminal()).toThrow(TerminalNotRunningError);
	});

	it("#given Apple Events returns error -1743 #when a command is dispatched #then permission guidance is surfaced without retry", async () => {
		const run = vi.fn<(script: string) => Promise<number | undefined>>(async () => {
			throw new Error("Not allowed to send Apple events (-1743)");
		});
		const session = createTerminalSession({ find: () => terminal, run, read: () => "" });
		await expect(session.runCommand({ command: "echo safe" })).rejects.toBeInstanceOf(
			TerminalAutomationPermissionError,
		);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("#given a WindowServer id #when a command is dispatched #then AppleScript targets that exact window", async () => {
		const { session, run } = setup();
		await session.runCommand({ command: "echo output", windowId: 91 });
		expect(run.mock.calls[0]?.[0]).toContain("in window id 91");
		expect(run.mock.calls[1]?.[0]).toContain("id of window id 91");
	});

	it("#given no window target #when the dispatch lands #then the new frontmost Terminal window is resolved", async () => {
		const { session, run } = setup();
		await expect(session.runCommand({ command: "echo output" })).resolves.toBe(91);
		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[1]?.[0]).toContain("id of window 1");
	});

	it("#given the dispatch happened but the window cannot be resolved #when runCommand ends #then it returns undefined without failing", async () => {
		const run = vi.fn<(script: string) => Promise<number | undefined>>(async (script: string) => {
			if (script.includes("ignoring application responses")) {
				return undefined;
			}
			throw new Error("window resolution failed");
		});
		const session = createTerminalSession({ find: () => terminal, run, read: () => "" });
		await expect(session.runCommand({ command: "echo output" })).resolves.toBeUndefined();
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("#given visible text arrives after dispatch #when capture polls #then the unique marker ends polling", async () => {
		const { session, read } = setup();
		read.mockReturnValueOnce("running").mockReturnValueOnce("running\napple-cua-marker-fixed");
		const delay = vi.fn(async () => undefined);
		const capture = await session.runAndCapture("echo output", {
			attempts: 3,
			createMarker: () => "apple-cua-marker-fixed",
			delay,
		});
		expect(capture).toEqual({ text: "running\napple-cua-marker-fixed", markerSeen: true });
		expect(read).toHaveBeenCalledTimes(2);
		expect(delay).toHaveBeenCalledTimes(1);
	});

	it("#given the marker stays absent #when capture exhausts its attempts #then the final visible text is returned", async () => {
		const { session, read } = setup();
		read.mockReturnValueOnce("first poll").mockReturnValueOnce("last poll");
		const capture = await session.runAndCapture("echo output", {
			attempts: 2,
			createMarker: () => "apple-cua-marker-fixed",
			delay: async () => undefined,
		});
		expect(capture).toEqual({ text: "last poll", markerSeen: false });
		expect(read).toHaveBeenCalledTimes(2);
	});
});
