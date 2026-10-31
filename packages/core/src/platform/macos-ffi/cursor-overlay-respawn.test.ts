import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Socket } from "node:net";
import { vi } from "@apple-cua/test-support";

const spawned = { count: 0 };
vi.mock("node:fs", () => ({ existsSync: () => true }));

const { defaultSocketTransport } = await import("./cursor-overlay.js");

// A fake daemon process, and nobody listens on its socket: every connection fails, as after the daemon's idle exit.
function spawnDaemon() {
	spawned.count += 1;
	return { on: () => undefined, unref: () => undefined };
}
function refusedConnection(): Socket {
	const socket = new Socket();
	queueMicrotask(() => socket.destroy(new Error("ECONNREFUSED")));
	return socket;
}
const SOCKET_PATH = "apple-cua-overlay-test.sock";

beforeEach(() => {
	spawned.count = 0;
	vi.useFakeTimers();
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("#given the overlay daemon exited after its idle timeout #when the agent acts again later", () => {
	it("#then a fresh daemon is started, so the agent cursor comes back for the rest of the session", async () => {
		let time = 0;
		const transport = defaultSocketTransport(() => time, spawnDaemon, undefined, SOCKET_PATH, refusedConnection);

		transport.send("set 10 10\n");
		await vi.runAllTimersAsync();
		expect(spawned.count).toBe(1);

		time = 20_000;
		transport.send("set 20 20\n");
		await vi.runAllTimersAsync();

		expect(spawned.count).toBe(2);
	});

	it("#then commands close together while one daemon is starting do not spawn duplicates", async () => {
		let time = 0;
		const transport = defaultSocketTransport(() => time, spawnDaemon, undefined, SOCKET_PATH, refusedConnection);

		transport.send("set 10 10\n");
		time = 150;
		transport.send("set 11 11\n");
		await vi.runAllTimersAsync();

		expect(spawned.count).toBe(1);
	});
});
