import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:child_process", () => ({
	spawn: () => {
		spawned.count += 1;
		return { on: () => undefined, unref: () => undefined };
	},
}));
// Nobody listens on the socket: every connection fails, as after the daemon's idle exit.
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
		const transport = defaultSocketTransport(() => time);

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
		const transport = defaultSocketTransport(() => time);

		transport.send("set 10 10\n");
		time = 150;
		transport.send("set 11 11\n");
		await vi.runAllTimersAsync();

		expect(spawned.count).toBe(1);
	});
});
