import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { type Server, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const endpoint = vi.hoisted(() => ({ path: "" }));
vi.mock("node:net", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:net")>();
	return { ...actual, connect: () => actual.connect(endpoint.path) };
});

import { defaultSocketTransport } from "./cursor-overlay.js";

let directory: string | undefined;
let server: Server | undefined;

afterEach(async () => {
	if (server !== undefined) {
		await new Promise<void>((resolve, reject) => {
			server?.close((error) => (error === undefined ? resolve() : reject(error)));
		});
		server = undefined;
	}
	if (directory !== undefined) {
		await rm(directory, { recursive: true, force: true });
		directory = undefined;
	}
	vi.restoreAllMocks();
});

describe("#given configured motion over a real socket #when commands arrive together #then they stay ordered", () => {
	it("queries state before planning and finishes the trajectory before mode and hide delivery", async () => {
		directory = await mkdtemp(join(tmpdir(), "apple-cua-motion-test-"));
		endpoint.path = join(directory, "overlay.sock");
		const events = new EventEmitter();
		const commands: string[] = [];
		server = createServer((socket) => {
			let buffer = "";
			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");
				let end = buffer.indexOf("\n");
				while (end >= 0) {
					const line = buffer.slice(0, end);
					buffer = buffer.slice(end + 1);
					commands.push(line);
					if (line === "state") {
						socket.write('{"x":120,"y":180,"shown":true,"reducedMotion":false}\n');
					}
					if (line === "hide") {
						events.emit("hidden");
					}
					end = buffer.indexOf("\n");
				}
			});
		});
		const listening = once(server, "listening", { signal: AbortSignal.timeout(5_000) });
		server.listen(endpoint.path);
		await listening;
		const hidden = once(events, "hidden", { signal: AbortSignal.timeout(5_000) });
		const transport = defaultSocketTransport(Date.now, undefined, { style: "magnetic" });

		transport.send("set 640 360\n");
		transport.send("mode thinking\n");
		transport.send("hide\n");
		transport.close();
		await hidden;

		expect(commands).toHaveLength(4);
		expect(commands[0]).toBe("state");
		expect(commands[2]).toBe("mode thinking");
		expect(commands[3]).toBe("hide");
		const trajectory = commands[1];
		if (trajectory === undefined) {
			throw new Error("Expected a trajectory command");
		}
		const payload: unknown = JSON.parse(trajectory.slice("trajectory ".length));
		expect(payload).toMatchObject({
			style: "magnetic",
			samples: expect.arrayContaining([
				[0, 120, 180, Math.PI / 4],
				[expect.any(Number), 640, 360, Math.PI / 4],
			]),
		});
	});

	it("rejects malformed state without sending a trajectory and still delivers the next hide", async () => {
		directory = await mkdtemp(join(tmpdir(), "apple-cua-motion-test-"));
		endpoint.path = join(directory, "overlay.sock");
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const events = new EventEmitter();
		const commands: string[] = [];
		server = createServer((socket) => {
			socket.on("data", (chunk: Buffer) => {
				const command = chunk.toString("utf8");
				commands.push(command);
				if (command === "state\n") {
					socket.write('{"x":"invalid","y":180,"shown":true,"reducedMotion":false}\n');
				} else if (command === "hide\n") {
					events.emit("hidden");
				}
			});
		});
		const listening = once(server, "listening", { signal: AbortSignal.timeout(5_000) });
		server.listen(endpoint.path);
		await listening;
		const hidden = once(events, "hidden", { signal: AbortSignal.timeout(5_000) });
		const transport = defaultSocketTransport(Date.now, undefined, { style: "signature_arc" });

		transport.send("set 640 360\n");
		transport.send("hide\n");
		await hidden;

		expect(commands).toEqual(["state\n", "hide\n"]);
		expect(stderr).toHaveBeenCalledTimes(1);
	});
});
