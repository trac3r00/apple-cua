import { afterEach, describe, expect, it } from "bun:test";
import type { CursorOwner, StopStatusSource } from "@apple-cua/core/isolated";
import { vi } from "@apple-cua/test-support";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod/v4";
import type { IsolatedDesktopSource } from "./isolated-server.js";

vi.mock("node:child_process", () => ({
	spawn: () => {
		throw new Error("An isolated protocol test attempted to start a process.");
	},
}));
vi.mock("node:net", () => ({
	Socket: class {
		constructor() {
			throw new Error("An isolated protocol test attempted to create a socket.");
		}
	},
}));

const { currentCursorOwner } = await import("@apple-cua/core/isolated");
const { createIsolatedMcpServer } = await import("./isolated-server.js");

const owner = { agentName: "OmO", sessionId: "fixture-session" };
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3l8AAAAASUVORK5CYII=",
	"base64",
);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function body(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
	const content = result.content;
	if (!Array.isArray(content) || content[0]?.type !== "text") throw new Error("Missing protocol text.");
	return z.record(z.string(), z.unknown()).parse(JSON.parse(String(content[0].text)));
}

function token(result: Awaited<ReturnType<Client["callTool"]>>): string {
	const value = body(result)["observation_token"];
	if (typeof value !== "string") throw new Error("Missing observation token.");
	return value;
}

async function fixture() {
	let stopped = false;
	let running = true;
	const size = { width: 1, height: 1 };
	const seenOwners: (CursorOwner | undefined)[] = [];
	const click = vi.fn(async (_x: number, _y: number) => {
		seenOwners.push(currentCursorOwner());
	});
	const move = vi.fn(async (_x: number, _y: number) => undefined);
	const refresh = vi.fn(async () => undefined);
	const screenshot = vi.fn(async () => ({ data: png, mimeType: "image/png" as const, width: 1, height: 1 }));
	const paste = vi.fn(async (_value: string) => undefined);
	const close = vi.fn(async () => {
		running = false;
	});
	const source: IsolatedDesktopSource = {
		supervisor: {
			status: () => ({
				owner,
				running,
				closing: !running,
				inputAvailable: running,
				display: { ...size },
				cursors: [],
			}),
			refreshDisplay: refresh,
			move,
			click,
			scroll: async () => undefined,
			drag: async () => undefined,
			chord: async () => undefined,
			close,
		},
		screenshot,
		paste,
		close,
	};
	const start = vi.fn(async () => source);
	const stop: StopStatusSource = {
		status: () =>
			stopped
				? { stopped: true, stoppedAt: "2026-10-30T00:00:00Z", reason: "fixture", source: "api" }
				: { stopped: false },
	};
	const server = createIsolatedMcpServer({ directory: "/fixture/owned-desktop", owner, stop, start });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "isolated-test", version: "0.0.0" });
	await client.connect(clientTransport);
	cleanups.push(async () => {
		await client.close();
		await server.close();
	});
	const call = (args: Record<string, unknown>) => client.callTool({ name: "virtual_desktop", arguments: args });
	return {
		client,
		call,
		start,
		click,
		move,
		refresh,
		screenshot,
		paste,
		close,
		seenOwners,
		size,
		stop: () => {
			stopped = true;
		},
	};
}

describe("#given the isolated MCP entrypoint #when used #then only the owned guest is exposed", () => {
	it("reports unavailable input before start and registers no native host tools", async () => {
		const test = await fixture();
		const names = (await test.client.listTools()).tools.map((tool) => tool.name).sort();
		expect(names).toEqual(["get_capabilities", "virtual_desktop"]);
		const status = body(await test.client.callTool({ name: "get_capabilities", arguments: {} }));
		expect(status).toMatchObject({
			backend: "isolated-macos",
			humanDesktopInput: false,
			hostClipboardSharing: false,
			guest: { running: false, inputAvailable: false },
		});
		expect(test.start).not.toHaveBeenCalled();
	});

	it("binds observation and action to the named child and returns the guest image", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const actor = { id: "reader-1", name: "Reader" };
		const observed = await test.call({ op: "observe", actor });
		expect(body(observed)["actor"]).toEqual({
			agentName: "Reader",
			parentAgentName: "OmO",
			sessionId: "fixture-session",
		});
		expect(observed.content).toContainEqual({ type: "image", mimeType: "image/png", data: png.toString("base64") });
		const acted = await test.call({
			op: "act",
			actor,
			observation_token: token(observed),
			action: { type: "click", x: 0, y: 0 },
		});
		expect(acted.isError).not.toBe(true);
		expect(body(acted)["dispatched"]).toBe(true);
		expect(test.seenOwners).toEqual([
			{
				agentName: "Reader",
				parentAgentName: "OmO",
				sessionId: "fixture-session",
			},
		]);
		expect(currentCursorOwner()).toBeUndefined();
	});

	it("refuses another actor's token before any input", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const observed = await test.call({ op: "observe", actor: { id: "reader", name: "Reader" } });
		const result = await test.call({
			op: "act",
			actor: { id: "writer", name: "Writer" },
			observation_token: token(observed),
			action: { type: "click", x: 0, y: 0 },
		});
		expect(result.isError).toBe(true);
		expect(body(result)["effect"]).toBe("refused");
		expect(test.click).not.toHaveBeenCalled();
	});

	it("consumes an observation token and refuses replay", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const observed = await test.call({ op: "observe" });
		const request = { op: "act", observation_token: token(observed), action: { type: "move", x: 0, y: 0 } };
		const first = await test.call(request);
		expect(first.isError).not.toBe(true);
		expect(token(first)).not.toBe(token(observed));
		expect((await test.call(request)).isError).toBe(true);
		expect(test.move).toHaveBeenCalledTimes(1);
	});

	it("rejects a display change detected before dispatch", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const observed = await test.call({ op: "observe" });
		test.refresh.mockImplementationOnce(async () => {
			test.size.width = 2;
			return undefined;
		});
		const result = await test.call({
			op: "act",
			observation_token: token(observed),
			action: { type: "click", x: 0, y: 0 },
		});
		expect(body(result)["message"]).toBe("guest-display-changed");
		expect(test.click).not.toHaveBeenCalled();
	});

	it("honors the human stop but still permits owned runtime cleanup", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const observed = await test.call({ op: "observe" });
		test.stop();
		const result = await test.call({
			op: "act",
			observation_token: token(observed),
			action: { type: "type", text: "must not be pasted" },
		});
		expect(body(result)["error"]).toBe("user-stopped");
		expect(test.paste).not.toHaveBeenCalled();
		await test.call({ op: "close" });
		expect(test.close).toHaveBeenCalledTimes(1);
	});

	it("does not describe a failed dispatch as proof that nothing happened", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const observed = await test.call({ op: "observe" });
		test.click.mockRejectedValueOnce(new Error("synthetic transport failure"));
		const result = await test.call({
			op: "act",
			observation_token: token(observed),
			action: { type: "click", x: 0, y: 0 },
		});
		expect(result.isError).toBe(true);
		expect(body(result)).toMatchObject({ error: "guest-action-unverified", effect: "unverifiable" });
	});

	it("keeps an actor ID bound to its original declared name", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		await test.call({ op: "observe", actor: { id: "reader", name: "Reader" } });
		const result = await test.call({ op: "observe", actor: { id: "reader", name: "Other" } });
		expect(body(result)["message"]).toBe("actor-name-changed");
		expect(test.screenshot).toHaveBeenCalledTimes(1);
	});

	it("does not register an actor that acts without observing", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		const forged = await test.call({
			op: "act",
			actor: { id: "ghost", name: "Ghost" },
			observation_token: "forged",
			action: { type: "move", x: 0, y: 0 },
		});
		expect(body(forged)["message"]).toBe("observation-required");
		expect(test.move).not.toHaveBeenCalled();
		const observed = await test.call({ op: "observe", actor: { id: "ghost", name: "Renamed" } });
		expect(observed.isError).not.toBe(true);
		expect(body(observed)["actor"]).toEqual({
			agentName: "Renamed",
			parentAgentName: "OmO",
			sessionId: "fixture-session",
		});
	});

	it("refuses a new actor once the server holds its limit of 64", async () => {
		const test = await fixture();
		await test.call({ op: "start" });
		// The coordinator itself holds one of the 64 places.
		for (let index = 1; index < 64; index += 1) {
			const observed = await test.call({ op: "observe", actor: { id: `worker-${index}`, name: `Worker ${index}` } });
			expect(observed.isError).not.toBe(true);
		}
		const refused = await test.call({ op: "observe", actor: { id: "worker-64", name: "Worker 64" } });
		expect(body(refused)["message"]).toBe("too-many-actors");
		const known = await test.call({ op: "observe", actor: { id: "worker-1", name: "Worker 1" } });
		expect(known.isError).not.toBe(true);
	});
});
