import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { z } from "zod";
import { BrowserBridge } from "./bridge.js";
import { BrowserController } from "./controller.js";

describe("browser task-space RPC", () => {
	const cleanup: (() => Promise<void>)[] = [];

	afterEach(async () => {
		for (const close of cleanup.splice(0)) await close();
	});

	async function harness() {
		const bridge = new BrowserBridge({ status: () => ({ stopped: false }) }, 1000, "a".repeat(64));
		const controller = new BrowserController(bridge);
		bridge.setRpcHandler((input) => controller.dispatch(input));
		const port = await bridge.listen(0);
		const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
			headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
		});
		await once(socket, "open");
		const ready = once(socket, "message");
		socket.send(JSON.stringify({ token: bridge.token }));
		await ready;
		let nextTab = 1;
		const requests: string[] = [];
		socket.on("message", (raw) => {
			const packet = z
				.object({
					id: z.string(),
					command: z.object({ method: z.string() }),
				})
				.parse(JSON.parse(raw.toString()));
			requests.push(packet.command.method);
			const value = packet.command.method === "open" ? { tabId: nextTab++ } : {};
			socket.send(JSON.stringify({ id: packet.id, ok: true, value }));
		});
		cleanup.push(async () => {
			socket.terminate();
			await bridge.close();
		});
		const rpc = async (input: unknown, headers: Record<string, string> = {}) =>
			await fetch(`http://127.0.0.1:${port}/rpc`, {
				method: "POST",
				headers: { authorization: `Bearer ${bridge.token}`, ...headers },
				body: JSON.stringify(input),
				signal: AbortSignal.timeout(3000),
			});
		return { rpc, bridge, socket, requests };
	}

	it("#given named spaces #when separate RPC calls open pages #then labels remain scoped and stable", async () => {
		const { rpc } = await harness();
		const first = await rpc({ action: "open", space: "alpha", url: "https://example.test" });
		const second = await rpc({ action: "open", space: "alpha", url: "https://example.test" });
		const other = await rpc({ action: "open", space: "beta", url: "https://example.test" });
		expect(await first.json()).toEqual({ space: "alpha", page: "p1" });
		expect(await second.json()).toEqual({ space: "alpha", page: "p2" });
		expect(await other.json()).toEqual({ space: "beta", page: "p1" });
		const status = await rpc({ action: "status" });
		expect(await status.json()).toMatchObject({
			spaces: [
				{ space: "alpha", pages: ["p1", "p2"] },
				{ space: "beta", pages: ["p1"] },
			],
		});
	});

	it("#given an authenticated web origin #when calling RPC #then denies the browser-page request", async () => {
		const { rpc, requests } = await harness();
		const response = await rpc({ action: "open", url: "https://example.test" }, { origin: "https://example.test" });
		expect(response.status).toBe(403);
		expect(requests).toEqual([]);
	});

	it("#given the wrong local key #when calling RPC #then refuses without dispatch", async () => {
		const { rpc, requests } = await harness();
		const response = await rpc({ action: "open", url: "https://example.test" }, { authorization: "Bearer wrong" });
		expect(response.status).toBe(403);
		expect(requests).toEqual([]);
	});

	it("#given owned pages #when finishing a space #then closes only its pages", async () => {
		const { rpc, requests } = await harness();
		await rpc({ action: "open", space: "alpha", url: "https://example.test" });
		await rpc({ action: "open", space: "beta", url: "https://example.test" });
		const response = await rpc({ action: "finish", space: "alpha" });
		expect(await response.json()).toEqual({ finished: "alpha" });
		expect(requests).toEqual(["open", "open", "close"]);
		const status = await rpc({ action: "status" });
		expect(await status.json()).toMatchObject({ spaces: [{ space: "beta", pages: ["p1"] }] });
	});

	it("#given an unknown page #when requesting observation #then refuses without extension input", async () => {
		const { rpc, requests } = await harness();
		const response = await rpc({ action: "observe", space: "missing", page: "p1" });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: "stale" });
		expect(requests).toEqual([]);
	});

	it("#given lost ownership #when finishing a space #then reports abandoned pages without closing unknown tabs", async () => {
		const { rpc, bridge, socket, requests } = await harness();
		await rpc({ action: "open", space: "alpha", url: "https://example.test" });
		const disconnected = once(bridge, "disconnected");
		socket.terminate();
		await disconnected;
		const response = await rpc({ action: "finish", space: "alpha" });
		expect(await response.json()).toEqual({ finished: "alpha", abandoned: ["p1"] });
		expect(requests).toEqual(["open"]);
	});
});
