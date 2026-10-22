import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const SUPERVISED_CHILD_FLAG = "--supervised-child";
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const UNKNOWN_OUTCOME =
	"apple-cua restarted while this call ran; its outcome is unknown. Observe again before acting and never replay it.";

export interface SupervisedChild {
	readonly stdin: Writable;
	readonly stdout: Readable;
	readonly kill: (signal?: NodeJS.Signals) => void;
	readonly onExit: (listener: () => void) => () => void;
}

export interface SupervisorOptions {
	readonly spawnChild: () => SupervisedChild;
	readonly input: Readable;
	readonly output: Writable;
	readonly log: (line: string) => void;
	readonly changes?: { readonly subscribe: (listener: (reason: string) => void) => () => void };
	readonly maxCrashes?: number;
	readonly crashWindowMs?: number;
	readonly now?: () => number;
}

export interface SupervisorHandle {
	readonly done: Promise<number>;
	readonly requestRestart: (reason: string) => void;
}

/** Byte-bounded NDJSON framing. Oversized lines are discarded through their next newline. */
export class LineFramer {
	private decoder = new StringDecoder("utf8");
	private text = "";
	private bytes = 0;
	private rejected = false;

	constructor(
		private readonly line: (line: string) => void,
		private readonly reject: () => void,
		private readonly maxBytes = MAX_LINE_BYTES,
	) {
		// Decoder state belongs to this stream.
	}

	write(chunk: Buffer): void {
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(10, offset);
			const end = newline < 0 ? chunk.length : newline;
			const part = chunk.subarray(offset, end);
			this.bytes += part.length;
			if (!this.rejected && this.bytes > this.maxBytes) {
				this.rejected = true;
				this.text = "";
				this.reject();
			}
			if (!this.rejected) this.text += this.decoder.write(part);
			if (newline >= 0) {
				if (!this.rejected) this.line(this.text + this.decoder.end());
				this.decoder = new StringDecoder("utf8");
				this.text = "";
				this.bytes = 0;
				this.rejected = false;
			}
			offset = newline < 0 ? chunk.length : newline + 1;
		}
	}

	end(): void {
		if (this.bytes > 0 && !this.rejected) this.line(this.text + this.decoder.end());
		this.text = "";
		this.bytes = 0;
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Id = string | number | null;
function hasId(value: Record<string, unknown>): value is Record<string, unknown> & { id: Id } {
	return "id" in value && (value["id"] === null || typeof value["id"] === "string" || typeof value["id"] === "number");
}

export function startSupervisor(options: SupervisorOptions): SupervisorHandle {
	let finish: (code: number) => void = () => undefined;
	const done = new Promise<number>((resolveDone) => {
		finish = resolveDone;
	});
	let stopped = false;
	let child: SupervisedChild | undefined;
	let detach: () => void = () => undefined;
	let unsubscribe: () => void = () => undefined;
	let restarting = false;
	let pendingRestart: string | undefined;
	let initialization: Record<string, unknown> | undefined;
	let initialized = false;
	let rewritten = false;
	let internalId: string | undefined;
	let generation = 0;
	const inFlight = new Map<Id, Record<string, unknown>>();
	let queued: Record<string, unknown>[] = [];
	let crashes: number[] = [];
	const send = (message: unknown) => options.output.write(`${JSON.stringify(message)}\n`);
	const error = (id: Id, message: string, code = -32000) => {
		send({ jsonrpc: "2.0", id, error: { code, message } });
	};
	const failRequests = (reason: string, includeQueued = true) => {
		for (const id of inFlight.keys()) error(id, reason);
		inFlight.clear();
		if (!includeQueued) return;
		for (const message of queued) {
			if (hasId(message) && typeof message["method"] === "string") error(message.id, reason);
		}
		queued = [];
	};
	const stop = (code: number) => {
		if (stopped) return;
		stopped = true;
		unsubscribe();
		detach();
		options.input.off("data", inputData);
		options.input.off("end", inputEnd);
		options.input.off("error", inputError);
		child?.stdin.end();
		child?.kill("SIGTERM");
		finish(code);
	};
	const forward = (message: Record<string, unknown>) => {
		if (hasId(message) && typeof message["method"] === "string") inFlight.set(message.id, message);
		child?.stdin.write(`${JSON.stringify(message)}\n`);
	};
	const restartIfIdle = () => {
		if (stopped || restarting || !pendingRestart || inFlight.size > 0) return;
		options.log(`apple-cua restarting: ${pendingRestart}`);
		pendingRestart = undefined;
		restarting = true;
		child?.kill("SIGTERM");
	};
	const receive = (line: string) => {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			options.log("apple-cua child emitted malformed JSON");
			return;
		}
		if (!record(message)) return;
		if (hasId(message) && typeof message["method"] !== "string") {
			if (internalId !== undefined && message.id === internalId) {
				internalId = undefined;
				if ("error" in message) {
					options.log("apple-cua child re-initialization failed");
					failRequests("apple-cua re-initialization failed");
					stop(1);
					return;
				}
				if (initialized) child?.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
				restarting = false;
				send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
				const waiting = queued;
				queued = [];
				for (const request of waiting) forward(request);
				restartIfIdle();
				return;
			}
			const responseId = message.id;
			const request = inFlight.get(responseId);
			if (!rewritten && request?.["method"] === "initialize" && record(message["result"])) {
				const result = message["result"];
				const capabilities = record(result["capabilities"]) ? result["capabilities"] : {};
				const tools = record(capabilities["tools"]) ? capabilities["tools"] : {};
				message = {
					...message,
					result: { ...result, capabilities: { ...capabilities, tools: { ...tools, listChanged: true } } },
				};
				rewritten = true;
			}
			// Preserve response-before-restart ordering on the client stream.
			send(message);
			inFlight.delete(responseId);
			restartIfIdle();
			return;
		}
		send(message);
	};
	const launch = () => {
		if (stopped) return;
		try {
			const current = options.spawnChild();
			child = current;
			const framer = new LineFramer(receive, () => options.log("apple-cua child line exceeded 32 MiB"));
			const data = (chunk: Buffer) => framer.write(chunk);
			const streamError = (cause: Error) => {
				options.log(`apple-cua child stream failed: ${cause.message}`);
				current.kill("SIGTERM");
			};
			current.stdout.on("data", data);
			current.stdout.on("error", streamError);
			current.stdin.on("error", streamError);
			const removeExit = current.onExit(() => {
				detach();
				child = undefined;
				if (stopped) return;
				if (!restarting || internalId !== undefined) {
					failRequests(UNKNOWN_OUTCOME, false);
					const now = (options.now ?? Date.now)();
					crashes = crashes.filter((time) => now - time <= (options.crashWindowMs ?? 60_000));
					crashes.push(now);
					if (crashes.length > (options.maxCrashes ?? 5)) {
						options.log("apple-cua crash loop: restart limit exceeded");
						failRequests("apple-cua crash loop: restart limit exceeded");
						stop(1);
						return;
					}
				}
				restarting = true;
				internalId = undefined;
				pendingRestart = undefined;
				launch();
			});
			detach = () => {
				removeExit();
				current.stdout.off("data", data);
				current.stdout.off("error", streamError);
				current.stdin.off("error", streamError);
			};
			if (restarting) {
				if (initialization) {
					internalId = `apple-cua-supervisor-init-${++generation}`;
					current.stdin.write(`${JSON.stringify({ ...initialization, id: internalId })}\n`);
				} else {
					restarting = false;
					send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
				}
			}
		} catch (cause) {
			options.log(`apple-cua spawn failed: ${cause instanceof Error ? cause.message : String(cause)}`);
			failRequests("apple-cua could not start");
			stop(1);
		}
	};
	const parseError = () => error(null, "Parse error", -32700);
	const inputFramer = new LineFramer((line) => {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			parseError();
			return;
		}
		if (!record(message)) {
			error(null, "Invalid Request", -32600);
			return;
		}
		if (message["method"] === "initialize") initialization = message;
		if (message["method"] === "notifications/initialized") initialized = true;
		if (restarting) queued.push(message);
		else forward(message);
	}, parseError);
	const inputData = (chunk: Buffer) => inputFramer.write(chunk);
	const inputEnd = () => {
		inputFramer.end();
		stop(0);
	};
	const inputError = (cause: Error) => {
		options.log(`apple-cua input failed: ${cause.message}`);
		failRequests("apple-cua input failed");
		stop(1);
	};
	const requestRestart = (reason: string) => {
		if (stopped || restarting) return;
		pendingRestart ??= reason;
		restartIfIdle();
	};
	options.input.on("data", inputData);
	options.input.on("end", inputEnd);
	options.input.on("error", inputError);
	launch();
	if (!stopped) unsubscribe = options.changes?.subscribe(requestRestart) ?? unsubscribe;
	return { done, requestRestart };
}

/** Production resources live only for the changes subscription and are disposed on supervisor shutdown. */
export function nodeSupervisorOptions(
	scriptPath: string,
	argv: readonly string[],
	/** The server's non-prompting permission report flag; passed in so this module never loads the native core. */
	selfCheckFlag: string,
): SupervisorOptions {
	let probeAtStart: () => void = () => undefined;
	return {
		input: process.stdin,
		output: process.stdout,
		log: (line) => process.stderr.write(`${line}\n`),
		spawnChild: () => {
			const child = spawn(process.execPath, [scriptPath, SUPERVISED_CHILD_FLAG, ...argv], {
				env: { ...process.env, APPLE_CUA_SUPERVISED: "1" },
				stdio: ["pipe", "pipe", "inherit"],
			});
			probeAtStart();
			return {
				stdin: child.stdin,
				stdout: child.stdout,
				kill: (signal) => {
					child.kill(signal);
				},
				onExit: (listener) => {
					child.once("exit", listener);
					child.once("error", listener);
					return () => {
						child.off("exit", listener);
						child.off("error", listener);
					};
				},
			};
		},
		changes: {
			subscribe: (listener) => {
				let disposed = false;
				let debounce: ReturnType<typeof setTimeout> | undefined;
				let interval: ReturnType<typeof setTimeout> | undefined;
				let previous: Record<string, unknown> | undefined;
				let probing: ReturnType<typeof spawn> | undefined;
				const probe = () => {
					if (disposed || probing) return;
					if (interval) clearTimeout(interval);
					const processProbe = spawn(process.execPath, [scriptPath, selfCheckFlag], {
						env: { ...process.env, APPLE_CUA_SUPERVISED: "1" },
						stdio: ["ignore", "pipe", "ignore"],
					});
					probing = processProbe;
					let text = "";
					processProbe.stdout.on("data", (chunk: Buffer) => {
						text += chunk.toString("utf8");
					});
					processProbe.once("error", (cause) => {
						process.stderr.write(`apple-cua permission probe: ${cause.message}\n`);
					});
					processProbe.once("close", (code) => {
						probing = undefined;
						if (disposed) return;
						if (code === 0) {
							try {
								const report: unknown = JSON.parse(text);
								if (record(report) && record(report["permissions"])) {
									const permissions = report["permissions"];
									const granted = Object.keys(permissions).some(
										(key) => previous?.[key] === false && permissions[key] === true,
									);
									previous = permissions;
									if (granted) listener("permission-granted");
								}
							} catch (cause) {
								process.stderr.write(`apple-cua permission probe: ${String(cause)}\n`);
							}
						}
						if (previous && Object.values(previous).includes(false)) interval = setTimeout(probe, 15_000);
					});
				};
				probeAtStart = probe;
				const directory = dirname(scriptPath);
				const directories = [directory, resolve(directory, "../../core/dist")].filter(existsSync);
				const watchers = directories.map((path) =>
					watch(path, (_event, filename) => {
						if (filename?.endsWith(".map")) return;
						if (debounce) clearTimeout(debounce);
						debounce = setTimeout(() => listener("build-changed"), 1_000);
					}),
				);
				// The first child starts before the subscription is installed.
				probe();
				return () => {
					disposed = true;
					probeAtStart = () => undefined;
					if (debounce) clearTimeout(debounce);
					if (interval) clearTimeout(interval);
					for (const watcher of watchers) watcher.close();
					probing?.kill("SIGTERM");
				};
			},
		},
	};
}
