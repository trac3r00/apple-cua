import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { StopStatusSource } from "@apple-cua/core";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { type BrowserCommand, BrowserError, replySchema } from "./protocol.js";

const helloSchema = z.object({ token: z.string().max(128) });
const eventSchema = z.discriminatedUnion("event", [
	z.object({ event: z.literal("heartbeat") }),
	z.object({ event: z.literal("stop") }),
	z.object({ event: z.literal("checkpoint"), id: z.string(), step: z.number().int().nonnegative() }),
]);

export interface BrowserTransport {
	readonly generation: number;
	request(command: BrowserCommand): Promise<unknown>;
}

/** A single paired extension. Commands are never replayed after uncertain outcomes. */
export class BrowserBridge extends EventEmitter implements BrowserTransport {
	readonly token: string;
	private readonly http = createServer((request, response) => {
		void this.handleHttp(request, response);
	});
	private rpcHandler: ((value: unknown, signal: AbortSignal) => Promise<unknown>) | undefined;
	private readonly cancellation = new AsyncLocalStorage<AbortSignal>();
	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
	private socket: WebSocket | undefined;
	private stopped = false;
	private epoch = 0;
	private readonly pending = new Map<
		string,
		{
			readonly command: BrowserCommand;
			readonly resolve: (value: unknown) => void;
			readonly reject: (error: BrowserError) => void;
			readonly timer: ReturnType<typeof setTimeout>;
			readonly cleanup: () => void;
		}
	>();

	constructor(
		private readonly stopSource: StopStatusSource,
		private readonly timeoutMs = 15000,
		token = randomBytes(32).toString("hex"),
	) {
		super();
		this.token = token;
		this.http.on("upgrade", (request, socket, head) => {
			const origin = request.headers.origin;
			if (
				request.url !== "/" ||
				origin === undefined ||
				!/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
				this.socket !== undefined
			) {
				socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
				return;
			}
			this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws));
		});
	}

	get generation(): number {
		return this.epoch;
	}

	get connected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	get paused(): boolean {
		return this.stopped || this.stopSource.status().stopped;
	}

	setRpcHandler(handler: (value: unknown, signal: AbortSignal) => Promise<unknown>): void {
		this.rpcHandler = handler;
	}

	withCancellation<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
		return this.cancellation.run(signal, action);
	}

	private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (request.method !== "POST" || request.url !== "/rpc" || this.rpcHandler === undefined) {
			response.writeHead(404).end();
			return;
		}
		const authorization = request.headers.authorization;
		const supplied = Buffer.from(authorization?.startsWith("Bearer ") ? authorization.slice(7) : "");
		const expected = Buffer.from(this.token);
		if (
			request.headers.origin !== undefined ||
			supplied.length !== expected.length ||
			!timingSafeEqual(supplied, expected)
		) {
			response.writeHead(403, { "content-type": "application/json" }).end(
				JSON.stringify({
					error: "unauthorized",
					message: "The local connection key is invalid or the request has a browser origin.",
				}),
			);
			return;
		}
		try {
			const cancellation = new AbortController();
			response.once("close", () => {
				if (!response.writableEnded) cancellation.abort();
			});
			const chunks: Buffer[] = [];
			let bytes = 0;
			for await (const chunk of request) {
				if (!Buffer.isBuffer(chunk)) throw new BrowserError("extension", "Invalid RPC body");
				bytes += chunk.length;
				if (bytes > 256000) {
					response.writeHead(413).end();
					return;
				}
				chunks.push(chunk);
			}
			const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			const value = await this.rpcHandler(input, cancellation.signal);
			response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
		} catch (error: unknown) {
			const known = error instanceof BrowserError || error instanceof z.ZodError || error instanceof SyntaxError;
			const code = error instanceof BrowserError ? error.code : "invalid_request";
			const message = known && error instanceof Error ? error.message : "Internal browser RPC error";
			response
				.writeHead(known ? 400 : 500, { "content-type": "application/json" })
				.end(JSON.stringify({ error: code, message }));
			if (!known) process.stderr.write(`${message}\n`);
		}
	}

	async listen(port = 47953): Promise<number> {
		await new Promise<void>((resolve, reject) => {
			this.http.once("error", reject);
			this.http.listen(port, "127.0.0.1", () => {
				this.http.removeListener("error", reject);
				resolve();
			});
		});
		const address = this.http.address();
		if (address === null || typeof address === "string") throw new BrowserError("extension", "No loopback address");
		return address.port;
	}

	private accept(ws: WebSocket): void {
		let authenticated = false;
		const helloTimer = setTimeout(() => ws.close(1008, "Pairing required"), 3000);
		ws.on("message", (raw) => {
			let value: unknown;
			try {
				value = JSON.parse(raw.toString());
			} catch {
				ws.close(1008, "Invalid JSON");
				return;
			}
			if (!authenticated) {
				const hello = helloSchema.safeParse(value);
				const candidate = Buffer.from(hello.success ? hello.data.token : "");
				const expected = Buffer.from(this.token);
				if (
					this.socket !== undefined ||
					candidate.length !== expected.length ||
					!timingSafeEqual(candidate, expected)
				) {
					ws.close(1008, "Invalid pairing");
					return;
				}
				clearTimeout(helloTimer);
				authenticated = true;
				this.socket = ws;
				this.stopped = false;
				this.epoch++;
				ws.send(JSON.stringify({ ready: true }));
				this.emit("connected");
				return;
			}
			const event = eventSchema.safeParse(value);
			if (event.success) {
				switch (event.data.event) {
					case "heartbeat":
						return;
					case "stop":
						this.stopped = true;
						this.failPending(
							new BrowserError("stopped", "Browser control was stopped. Re-observe after human resume."),
						);
						return;
					case "checkpoint": {
						const pending = this.pending.get(event.data.id);
						ws.send(
							JSON.stringify({
								checkpoint: event.data.id,
								allowed: pending?.command.method === "run" && !this.paused,
							}),
						);
						return;
					}
				}
			}
			const reply = replySchema.safeParse(value);
			if (!reply.success) {
				ws.close(1008, "Invalid reply");
				return;
			}
			const call = this.pending.get(reply.data.id);
			if (call === undefined) return;
			clearTimeout(call.timer);
			call.cleanup();
			this.pending.delete(reply.data.id);
			if (reply.data.ok) call.resolve(reply.data.value);
			else call.reject(new BrowserError("extension", reply.data.error));
		});
		ws.on("error", () => ws.close());
		ws.on("close", () => {
			clearTimeout(helloTimer);
			if (this.socket !== ws) return;
			this.socket = undefined;
			this.epoch++;
			this.emit("disconnected");
			this.failPending(
				new BrowserError("disconnected", "Extension disconnected; outcome may be uncertain. Do not replay input."),
			);
		});
	}

	request(command: BrowserCommand): Promise<unknown> {
		const signal = this.cancellation.getStore();
		if (signal?.aborted)
			return Promise.reject(new BrowserError("stopped", "Browser request was cancelled. Do not replay input."));
		const socket = this.socket;
		if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new BrowserError("disconnected", "Pair the apple-cua browser extension first."));
		}
		if ((command.method === "open" || command.method === "run") && this.paused) {
			return Promise.reject(
				new BrowserError("stopped", "The user stopped apple-cua. Do not retry or resume it yourself."),
			);
		}
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				cleanup();
				this.stopped = true;
				socket.send(JSON.stringify({ id: randomUUID(), command: { method: "stop" } }));
				reject(
					new BrowserError(
						"timeout",
						`Browser ${command.method} timed out; input may have occurred. Re-observe, never replay.`,
					),
				);
			}, this.timeoutMs);
			const cancelled = () => {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(
					new BrowserError("stopped", "Browser request was cancelled; input may have occurred. Do not replay it."),
				);
			};
			const cleanup = () => signal?.removeEventListener("abort", cancelled);
			signal?.addEventListener("abort", cancelled, { once: true });
			this.pending.set(id, { command, resolve, reject, timer, cleanup });
			socket.send(JSON.stringify({ id, command }));
		});
	}

	private failPending(error: BrowserError): void {
		for (const call of this.pending.values()) {
			clearTimeout(call.timer);
			call.cleanup();
			call.reject(error);
		}
		this.pending.clear();
	}

	async close(): Promise<void> {
		this.failPending(new BrowserError("disconnected", "Browser bridge closed"));
		for (const client of this.wss.clients) client.terminate();
		await new Promise<void>((resolve) => this.wss.close(() => resolve()));
		await new Promise<void>((resolve, reject) => this.http.close((error) => (error ? reject(error) : resolve())));
	}
}
