import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ existsSync: () => true }));
// Nobody listens on the socket: every connection fails, so each command asks for a daemon.
vi.mock("node:net", () => ({
	connect: () => {
		const socket = Object.assign(new EventEmitter(), {
			write: () => true,
			end: () => undefined,
			destroy: () => undefined,
		});
		queueMicrotask(() => socket.emit("error", new Error("ECONNREFUSED")));
		return socket;
	},
}));

import { defaultSocketTransport } from "./cursor-overlay.js";

afterEach(() => {
	vi.restoreAllMocks();
});

function failingSpawn() {
	const calls: string[] = [];
	const spawnProcess = (command: string) => {
		calls.push(command);
		const child = new EventEmitter();
		// ENOENT/EACCES arrive asynchronously as an 'error' event on the child, not as a thrown exception.
		queueMicrotask(() => child.emit("error", new Error("spawn overlay ENOENT")));
		return { on: child.on.bind(child), unref: () => undefined };
	};
	return { calls, spawnProcess };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("#given the overlay binary cannot be spawned #when a command is sent #then the process survives", () => {
	it("handles the async spawn error instead of leaving it unhandled, and reports it once on stderr", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const { calls, spawnProcess } = failingSpawn();
		const transport = defaultSocketTransport(() => 0, spawnProcess);
		const uncaught: Error[] = [];
		const onUncaught = (error: Error) => uncaught.push(error);
		process.on("uncaughtException", onUncaught);
		try {
			transport.send("set 10 10\n");
			await settle();
			await settle();
		} finally {
			process.off("uncaughtException", onUncaught);
		}

		expect(calls).toHaveLength(1);
		expect(uncaught).toEqual([]);
		const reports = stderr.mock.calls.filter((call) => String(call[0]).includes("cursor overlay unavailable"));
		expect(reports).toHaveLength(1);
		expect(String(reports[0]?.[0])).toContain("spawn overlay ENOENT");
	});

	it("stops respawning after the failure, so later commands are silent no-ops", async () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const { calls, spawnProcess } = failingSpawn();
		let time = 0;
		const transport = defaultSocketTransport(() => time, spawnProcess);

		transport.send("set 10 10\n");
		await settle();
		await settle();
		time = 60_000;
		transport.send("set 20 20\n");
		await settle();
		await settle();

		expect(calls).toHaveLength(1);
		expect(stderr.mock.calls.filter((call) => String(call[0]).includes("cursor overlay unavailable"))).toHaveLength(
			1,
		);
	});
});
