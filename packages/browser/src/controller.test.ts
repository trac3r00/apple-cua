import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { z } from "zod";
import { BrowserBridge } from "./bridge.js";
import { BrowserController, controllerRequestSchema } from "./controller.js";

describe("browser task-space RPC", () => {
	const cleanup: (() => Promise<void>)[] = [];

	it("#given a closing space #when opening concurrently #then refuses without creating a tab", async () => {
		const bridge = new BrowserBridge({ status: () => ({ stopped: false }) });
		const request = vi.spyOn(bridge, "request").mockResolvedValue({ tabId: 7 });
		const controller = new BrowserController(bridge);
		await controller.dispatch({ action: "open", url: "https://example.test" });
		request.mockResolvedValue({ tabId: 8 });
		let release: (_value: unknown) => void = (_value) => undefined;
		request.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const finishing = controller.dispatch({ action: "finish" });
		try {
			await expect(controller.dispatch({ action: "open", url: "https://example.test" })).rejects.toMatchObject({
				code: "busy",
			});
			expect(request).toHaveBeenCalledTimes(2);
		} finally {
			release({});
			await finishing;
		}
		expect(await controller.dispatch({ action: "status" })).toMatchObject({ spaces: [] });
	});

	it("#given an opening space #when finishing concurrently #then retains ownership until open settles", async () => {
		const bridge = new BrowserBridge({ status: () => ({ stopped: false }) });
		let release: (_value: unknown) => void = (_value) => undefined;
		const request = vi.spyOn(bridge, "request").mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const controller = new BrowserController(bridge);
		const opening = controller.dispatch({ action: "open", url: "https://example.test" });
		try {
			await expect(controller.dispatch({ action: "finish" })).rejects.toMatchObject({ code: "busy" });
		} finally {
			release({ tabId: 7 });
			await opening;
		}
		request.mockResolvedValue({});
		await controller.dispatch({ action: "finish" });
		expect(request).toHaveBeenLastCalledWith({ method: "close", tabId: 7 });
	});

	afterEach(async () => {
		for (const close of cleanup.splice(0)) await close();
	});

	it("#given wait control inputs #when parsing timeout bounds #then rejects zero and oversized values", () => {
		expect(() => controllerRequestSchema.parse({ action: "wait_control", timeoutMs: 0 })).toThrow();
		expect(() => controllerRequestSchema.parse({ action: "wait_control", timeoutMs: 120001 })).toThrow();
	});

	it("#given the controller #when status is read #then no controller action grants agent control", async () => {
		const { bridge, controller, socket } = await harness();
		const changed = once(bridge, "control");
		socket.send(JSON.stringify({ event: "control", owner: "human", reason: "taken_over" }));
		await changed;
		expect(await controller.dispatch({ action: "status" })).toMatchObject({
			control: "human",
			control_reason: "taken_over",
			handoff_requested: null,
		});
		await controller.dispatch({ action: "handoff", reason: "Please complete sign-in" });
		await expect(controller.dispatch({ action: "wait_control", timeoutMs: 20 })).resolves.toMatchObject({
			control: "human",
		});
		expect(bridge.control).toBe("human");
	});

	it("#given an extension #when controller requests handoff #then status records it until give-back", async () => {
		const { bridge, controller, socket } = await harness();
		const handoff = controller.dispatch({ action: "handoff", reason: "Please complete sign-in" });
		const message = await once(socket, "message");
		const packet = z.object({ id: z.string(), command: z.unknown() }).parse(JSON.parse(message[0].toString()));
		expect(packet.command).toEqual({ method: "handoff", reason: "Please complete sign-in" });
		socket.send(JSON.stringify({ id: packet.id, ok: true, value: null }));
		const requested = await handoff;
		expect(requested).toMatchObject({
			control: "agent",
			handoff_requested: { reason: "Please complete sign-in", requested_at: expect.any(String) },
		});
		expect(await controller.dispatch({ action: "status" })).toMatchObject({
			handoff_requested: { reason: "Please complete sign-in" },
		});
		const takenOver = once(bridge, "control");
		socket.send(JSON.stringify({ event: "control", owner: "human", reason: "taken_over" }));
		await takenOver;
		const returned = once(bridge, "control");
		socket.send(JSON.stringify({ event: "control", owner: "agent" }));
		await returned;
		expect(bridge.control).toBe("agent");
		expect(await controller.dispatch({ action: "status" })).toMatchObject({ handoff_requested: null });
	});

	it("#given human control #when controller waits #then resolves after extension give-back", async () => {
		const { bridge, controller, socket } = await harness();
		const takenOver = once(bridge, "control");
		socket.send(JSON.stringify({ event: "control", owner: "human" }));
		await takenOver;
		const waiting = controller.dispatch({ action: "wait_control", timeoutMs: 1000 });
		const returned = once(bridge, "control");
		socket.send(JSON.stringify({ event: "control", owner: "agent" }));
		await returned;
		await expect(waiting).resolves.toMatchObject({ control: "agent" });
	});

	it("#given human control #when controller waits to timeout #then reports current owner", async () => {
		const { bridge, controller, socket } = await harness();
		const takenOver = once(bridge, "control");
		socket.send(JSON.stringify({ event: "control", owner: "human" }));
		await takenOver;
		await expect(controller.dispatch({ action: "wait_control", timeoutMs: 20 })).resolves.toMatchObject({
			control: "human",
		});
	});

	async function harness(holdOpen = false) {
		const bridge = new BrowserBridge({ status: () => ({ stopped: false }) }, 1000, "a".repeat(64));
		const controller = new BrowserController(bridge);
		bridge.setRpcHandler((input, signal) => controller.dispatch(input, signal));
		const port = await bridge.listen(0);
		cleanup.push(() => bridge.close());
		const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
			headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
		});
		cleanup.unshift(async () => {
			socket.terminate();
		});
		await once(socket, "open");
		const ready = once(socket, "message");
		socket.send(JSON.stringify({ token: bridge.token }));
		await ready;
		let nextTab = 1;
		const requests: unknown[] = [];
		let replyOpen: (() => void) | undefined;
		let receivedOpen: (() => void) | undefined;
		const openingReceived = new Promise<void>((resolve) => {
			receivedOpen = resolve;
		});
		socket.on("message", (raw) => {
			const packet = z
				.object({
					id: z.string(),
					command: z.object({ method: z.string() }).passthrough(),
				})
				.parse(JSON.parse(raw.toString()));
			requests.push(packet.command);
			const value = packet.command.method === "open" ? { tabId: nextTab++ } : {};
			const reply = () => socket.send(JSON.stringify({ id: packet.id, ok: true, value }));
			if (holdOpen && packet.command.method === "open") {
				replyOpen = reply;
				receivedOpen?.();
			} else reply();
		});
		const rpc = async (input: unknown, headers: Record<string, string> = {}) =>
			await fetch(`http://127.0.0.1:${port}/rpc`, {
				method: "POST",
				headers: { authorization: `Bearer ${bridge.token}`, ...headers },
				body: JSON.stringify(input),
				signal: AbortSignal.timeout(3000),
			});
		return {
			rpc,
			bridge,
			socket,
			requests,
			controller,
			openingReceived,
			releaseOpen: () => {
				if (replyOpen === undefined) throw new Error("No open request received");
				replyOpen();
			},
		};
	}

	it("#given named spaces #when separate RPC calls open pages #then labels remain scoped and stable", async () => {
		const { rpc } = await harness();
		const first = await rpc({ action: "open", space: "alpha", url: "https://example.test" });
		const second = await rpc({ action: "open", space: "alpha", url: "https://example.test" });
		const other = await rpc({ action: "open", space: "beta", url: "https://example.test" });
		expect(await first.json()).toMatchObject({ space: "alpha", page: "p1", cursor_id: expect.any(String) });
		expect(await second.json()).toMatchObject({ space: "alpha", page: "p2", cursor_id: expect.any(String) });
		expect(await other.json()).toMatchObject({ space: "beta", page: "p1", cursor_id: expect.any(String) });
		const status = await rpc({ action: "status" });
		expect(await status.json()).toMatchObject({
			spaces: [
				{ space: "alpha", pages: ["p1", "p2"] },
				{ space: "beta", pages: ["p1"] },
			],
		});
	});

	it("#given a worker bound to one space #when assigning it another #then refuses without creating a second cursor", async () => {
		const opened = z.object({
			space: z.string(),
			page: z.string(),
			cursor_id: z.string(),
			worker_id: z.string().optional(),
		});
		const { rpc } = await harness();
		const first = opened.parse(
			await (
				await rpc({
					action: "open",
					space: "alpha",
					url: "https://example.test",
					worker_id: "research",
				})
			).json(),
		);
		const other = opened.parse(
			await (
				await rpc({
					action: "open",
					space: "beta",
					url: "https://example.test",
					worker_id: "verify",
				})
			).json(),
		);
		expect(first.worker_id).toBe("research");
		expect(other.worker_id).toBe("verify");
		expect(first.cursor_id).not.toBe(other.cursor_id);
		const conflict = await rpc({
			action: "open",
			space: "gamma",
			url: "https://example.test",
			worker_id: "research",
		});
		expect(conflict.status).toBe(400);
		expect(await conflict.json()).toMatchObject({ error: "busy" });
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
		expect(await response.json()).toMatchObject({ finished: "alpha", cursor_id: expect.any(String) });
		expect(requests).toEqual([
			{ method: "open", url: "https://example.test" },
			{ method: "open", url: "https://example.test" },
			{ method: "close", tabId: 1 },
		]);
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
		expect(await response.json()).toMatchObject({
			finished: "alpha",
			abandoned: ["p1"],
			cursor_id: expect.any(String),
		});
		expect(requests).toEqual([{ method: "open", url: "https://example.test" }]);
	});

	it("#given a dispatched open #when its caller cancels #then retains a labeled page for finish", async () => {
		const { controller, openingReceived, releaseOpen, requests } = await harness(true);
		const cancellation = new AbortController();
		const opening = controller.dispatch({ action: "open", url: "https://example.test" }, cancellation.signal);
		await openingReceived;
		cancellation.abort();
		releaseOpen();
		await expect(opening).resolves.toMatchObject({ space: "default", page: "p1", cursor_id: expect.any(String) });
		expect(await controller.dispatch({ action: "status" })).toMatchObject({
			spaces: [{ space: "default", pages: ["p1"] }],
		});
		await controller.dispatch({ action: "finish" });
		expect(requests).toEqual([
			{ method: "open", url: "https://example.test" },
			{ method: "close", tabId: 1 },
		]);
	});
});
