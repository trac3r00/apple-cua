import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { type Server, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { cursorOverlaySocketPath, defaultSocketTransport } from "./cursor-overlay.js";

describe("#given cursor identities #when resolving daemon sockets #then routing is isolated and stable", () => {
	it("routes distinct identities separately and repeats the same route deterministically", () => {
		const first = cursorOverlaySocketPath("agent-one");
		const second = cursorOverlaySocketPath("agent-two");

		expect(first).not.toBe(second);
		expect(cursorOverlaySocketPath("agent-one")).toBe(first);
		expect(first).toMatch(/ac-[a-f0-9]{24}\.sock$/);
	});

	it("rejects unsafe identities before they can form socket paths", () => {
		expect(cursorOverlaySocketPath("../other")).toMatch(/ac-[a-f0-9]{24}\.sock$/);
		expect(() => cursorOverlaySocketPath("")).toThrow(/identity/);
		expect(() => cursorOverlaySocketPath("bad\u0000identity")).toThrow(/identity/);
		expect(() => cursorOverlaySocketPath("x".repeat(1_025))).toThrow(/identity/);
	});

	it("uses a process-specific default while explicit identities reconnect across processes", () => {
		const firstDefault = cursorOverlaySocketPath();
		const explicit = cursorOverlaySocketPath("stable-cli-session");

		expect(firstDefault).toBe(cursorOverlaySocketPath());
		expect(firstDefault).not.toBe(explicit);
		expect(cursorOverlaySocketPath("stable-cli-session")).toBe(explicit);
	});

	it("#given a named cursor #when choosing its socket #then macOS can bind the actual path", async () => {
		const path = cursorOverlaySocketPath(`socket-qa-${process.pid}`);
		const server = createServer();
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.once("listening", resolve);
				server.listen(path);
			});
			expect(server.listening).toBe(true);
		} finally {
			if (server.listening) {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		}
	});

	it("keeps hide and close operations on one transport away from another socket", async () => {
		const directory = await mkdtemp(join(tmpdir(), "apple-cua-identity-test-"));
		const paths = [join(directory, "one.sock"), join(directory, "two.sock")];
		const received = [[], []] as string[][];
		const servers: Server[] = [];
		const events = new EventEmitter();
		try {
			for (const [index, path] of paths.entries()) {
				const server = createServer((socket) => {
					socket.on("data", (chunk: Buffer) => {
						const command = chunk.toString("utf8");
						received[index]?.push(command);
						events.emit(`data-${index}`, command);
					});
				});
				servers.push(server);
				const listening = once(server, "listening");
				server.listen(path);
				await listening;
			}

			const first = defaultSocketTransport(Date.now, undefined, undefined, paths[0]);
			const second = defaultSocketTransport(Date.now, undefined, undefined, paths[1]);
			const firstHidden = once(events, "data-0");
			first.send("hide\n");
			await firstHidden;
			first.close();

			const secondSet = once(events, "data-1");
			second.send("set 1 2\n");
			await secondSet;

			expect(received).toEqual([["hide\n"], ["set 1 2\n"]]);
		} finally {
			await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
			await rm(directory, { recursive: true, force: true });
		}
	});
});
