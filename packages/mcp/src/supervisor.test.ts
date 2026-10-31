import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { vi } from "@apple-cua/test-support";

/** Any report flag: the adapter must pass through exactly what the server gives it. */
const SELF_CHECK_FLAG = "--report-flag";
import type { SupervisedChild, SupervisorHandle } from "./supervisor.js";

type WatchListener = (event: string, filename: string | null) => void;
type Watch = (path: string, listener: WatchListener) => { close: () => void };

const native = vi.hoisted(() => ({
	spawn: vi.fn<(...args: unknown[]) => unknown>(),
	watch: vi.fn<Watch>(),
}));
vi.mock("node:child_process", () => ({ spawn: native.spawn }));
vi.mock("node:fs", () => ({ watch: native.watch, existsSync: () => true }));

const { LineFramer, nodeSupervisorOptions, startSupervisor } = await import("./supervisor.js");

class FakeChild implements SupervisedChild {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly messages: Record<string, unknown>[] = [];
	readonly kills: (NodeJS.Signals | undefined)[] = [];
	private readonly exits = new Set<() => void>();

	constructor() {
		const framer = new LineFramer(
			(line) => this.messages.push(JSON.parse(line)),
			() => undefined,
		);
		this.stdin.on("data", (chunk: Buffer) => framer.write(chunk));
	}

	onExit(listener: () => void): () => void {
		this.exits.add(listener);
		return () => this.exits.delete(listener);
	}

	kill(signal?: NodeJS.Signals): void {
		this.kills.push(signal);
	}

	exit(): void {
		for (const listener of [...this.exits]) listener();
	}

	reply(message: unknown): void {
		this.stdout.write(`${JSON.stringify(message)}\n`);
	}
}

interface Fixture {
	readonly input: PassThrough;
	readonly children: FakeChild[];
	readonly messages: Record<string, unknown>[];
	readonly logs: string[];
	readonly handle: SupervisorHandle;
	readonly change: (reason: string) => void;
	readonly unsubscribed: () => boolean;
	readonly setNow: (now: number) => void;
	readonly notifications: ReturnType<typeof vi.fn<(title: string, body: string) => void>>;
}

const fixtures: Fixture[] = [];
function fixture(maxCrashes = 5): Fixture {
	const input = new PassThrough();
	const output = new PassThrough();
	const children: FakeChild[] = [];
	const messages: Record<string, unknown>[] = [];
	const logs: string[] = [];
	let change: (reason: string) => void = () => undefined;
	let unsubscribed = false;
	let now = 0;
	const notifications = vi.fn<(title: string, body: string) => void>();
	const framer = new LineFramer(
		(line) => messages.push(JSON.parse(line)),
		() => undefined,
	);
	output.on("data", (chunk: Buffer) => framer.write(chunk));
	const handle = startSupervisor({
		input,
		output,
		log: (line) => logs.push(line),
		maxCrashes,
		now: () => now,
		notify: notifications,
		spawnChild: () => {
			const child = new FakeChild();
			children.push(child);
			return child;
		},
		changes: {
			subscribe: (listener) => {
				change = listener;
				return () => {
					unsubscribed = true;
				};
			},
		},
	});
	const result = {
		input,
		children,
		messages,
		logs,
		handle,
		change: (reason: string) => change(reason),
		unsubscribed: () => unsubscribed,
		setNow: (value: number) => {
			now = value;
		},
		notifications,
	};
	fixtures.push(result);
	return result;
}

function childAt(f: Fixture, index: number): FakeChild {
	const child = f.children[index];
	if (!child) throw new Error(`Missing child ${index}`);
	return child;
}

function send(f: Fixture, message: unknown): void {
	f.input.write(`${JSON.stringify(message)}\n`);
}

function initialize(f: Fixture): void {
	send(f, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
	childAt(f, 0).reply({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
	send(f, { jsonrpc: "2.0", method: "notifications/initialized" });
}

function replyToolsProbe(child: FakeChild, result: unknown = { tools: [] }): void {
	const probe = child.messages.at(-1);
	expect(probe).toMatchObject({ method: "tools/list" });
	child.reply({ jsonrpc: "2.0", id: probe?.["id"], result });
}

function reinitialize(child: FakeChild, completeProbe = true): void {
	const message = child.messages[0];
	expect(message).toMatchObject({ method: "initialize", params: { protocolVersion: "2025-03-26" } });
	child.reply({ jsonrpc: "2.0", id: message?.["id"], result: { capabilities: {} } });
	if (completeProbe) replyToolsProbe(child);
}

afterEach(async () => {
	for (const f of fixtures.splice(0)) {
		f.input.end();
		await f.handle.done;
	}
});

describe("stdio supervisor", () => {
	it.each([null, 0, "health"])(
		"#given an uninitialized transport #when ping has id %s #then replies without forwarding",
		(id) => {
			const f = fixture();
			send(f, { jsonrpc: "2.0", id, method: "ping" });
			expect(f.messages).toEqual([{ jsonrpc: "2.0", id, result: {} }]);
			expect(childAt(f, 0).messages).toEqual([]);
		},
	);

	it("#given initialize without initialized notification #when the client pings #then replies without forwarding", () => {
		const f = fixture();
		send(f, { id: 1, method: "initialize" });
		childAt(f, 0).reply({ id: 1, result: { capabilities: {} } });
		send(f, { id: 2, method: "ping" });
		expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
		expect(childAt(f, 0).messages).toEqual([{ id: 1, method: "initialize" }]);
	});

	it("#given a busy native child #when the client pings #then the supervisor replies without replaying the call", () => {
		const f = fixture();
		initialize(f);
		send(f, { jsonrpc: "2.0", id: 2, method: "tools/call" });
		send(f, { jsonrpc: "2.0", id: 3, method: "ping" });
		expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
		expect(childAt(f, 0).messages.at(-1)).toMatchObject({ id: 2, method: "tools/call" });
		expect(f.messages.some((message) => message["id"] === 2)).toBe(false);
	});

	it("#given a child reinitializing #when the client pings #then replies without waiting or queueing the ping", () => {
		const f = fixture();
		initialize(f);
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		send(f, { jsonrpc: "2.0", id: "health", method: "ping" });
		expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", id: "health", result: {} });
		const second = childAt(f, 1);
		reinitialize(second);
		expect(second.messages.map((message) => message["method"])).toEqual([
			"initialize",
			"notifications/initialized",
			"tools/list",
		]);
	});

	it("#given a tools baseline #when restarted tools only reorder object keys #then no list_changed is sent", () => {
		const f = fixture();
		initialize(f);
		send(f, { id: "baseline", method: "tools/list" });
		childAt(f, 0).reply({
			id: "baseline",
			result: { tools: [{ name: "observe", inputSchema: { type: "object", properties: {} } }] },
		});
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		const second = childAt(f, 1);
		reinitialize(second, false);
		const beforeProbe = [...f.messages];
		replyToolsProbe(second, { tools: [{ inputSchema: { properties: {}, type: "object" }, name: "observe" }] });
		expect(f.messages).toEqual(beforeProbe);
	});

	it("#given a tools baseline #when restarted tool schema changes #then list_changed is sent once", () => {
		const f = fixture();
		initialize(f);
		send(f, { id: "baseline", method: "tools/list" });
		childAt(f, 0).reply({ id: "baseline", result: { tools: [{ name: "observe", inputSchema: {} }] } });
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		reinitialize(childAt(f, 1), false);
		replyToolsProbe(childAt(f, 1), { tools: [{ name: "observe", inputSchema: { type: "object" } }] });
		expect(f.messages.filter((message) => message["method"] === "notifications/tools/list_changed")).toHaveLength(1);
	});

	it("#given no tools baseline #when two restarts expose identical tools #then only the first notifies", () => {
		const f = fixture();
		initialize(f);
		for (let index = 0; index < 2; index++) {
			f.handle.requestRestart("build-changed");
			childAt(f, index).exit();
			reinitialize(childAt(f, index + 1));
		}
		expect(f.messages.filter((message) => message["method"] === "notifications/tools/list_changed")).toHaveLength(1);
	});

	it("#given requests queued across reinitialization and probe #when the probe completes #then serves requests in order", () => {
		const f = fixture();
		initialize(f);
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		send(f, { id: "first", method: "tools/call" });
		const second = childAt(f, 1);
		reinitialize(second, false);
		send(f, { id: "second", method: "tools/list" });
		send(f, { id: "health", method: "ping" });
		expect(second.messages.map((message) => message["method"])).toEqual([
			"initialize",
			"notifications/initialized",
			"tools/list",
		]);
		expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", id: "health", result: {} });
		replyToolsProbe(second);
		expect(second.messages.slice(3)).toEqual([
			{ id: "first", method: "tools/call" },
			{ id: "second", method: "tools/list" },
		]);
		second.reply({ id: "first", result: {} });
		second.reply({ id: "second", result: { tools: [] } });
		expect(f.messages.slice(-2)).toEqual([
			{ id: "first", result: {} },
			{ id: "second", result: { tools: [] } },
		]);
	});

	it("#given a pending tools probe #when the child crashes #then queued calls survive the next restart", () => {
		const f = fixture();
		initialize(f);
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		reinitialize(childAt(f, 1), false);
		send(f, { id: "queued", method: "tools/call" });
		childAt(f, 1).exit();
		reinitialize(childAt(f, 2));
		expect(childAt(f, 2).messages.at(-1)).toEqual({ id: "queued", method: "tools/call" });
		expect(f.notifications).toHaveBeenCalledTimes(1);
	});

	it("#given queued calls during a tools probe #when the probe fails #then notifies and releases the queue", () => {
		const f = fixture();
		initialize(f);
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		const second = childAt(f, 1);
		reinitialize(second, false);
		const probe = second.messages.at(-1);
		send(f, { id: "queued", method: "tools/call" });
		second.reply({ id: probe?.["id"], error: { code: -32603, message: "Unavailable" } });
		expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
		expect(second.messages.at(-1)).toEqual({ id: "queued", method: "tools/call" });
	});

	it("#given a pending tools probe #when the child never answers #then times out, fails queued calls, and restarts", async () => {
		vi.useFakeTimers();
		try {
			const f = fixture();
			initialize(f);
			f.handle.requestRestart("build-changed");
			childAt(f, 0).exit();
			const second = childAt(f, 1);
			reinitialize(second, false);
			send(f, { id: "queued", method: "tools/call" });

			await vi.advanceTimersByTimeAsync(5_000);

			expect(f.logs).toContain("apple-cua tools/list probe timed out");
			expect(f.messages).toContainEqual({
				jsonrpc: "2.0",
				id: "queued",
				error: { code: -32000, message: "apple-cua re-initialization timed out; observe again before acting" },
			});
			expect(second.kills).toEqual(["SIGTERM"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("#given a pending tools probe #when stdin ends #then shuts down without forwarding queued calls", async () => {
		const f = fixture();
		initialize(f);
		f.handle.requestRestart("build-changed");
		childAt(f, 0).exit();
		const second = childAt(f, 1);
		reinitialize(second, false);
		send(f, { id: "queued", method: "tools/call" });
		f.input.end();
		expect(await f.handle.done).toBe(0);
		expect(second.stdin.writableEnded).toBe(true);
		expect(second.kills).toEqual(["SIGTERM"]);
		expect(second.messages.some((message) => message["id"] === "queued")).toBe(false);
	});

	it("#given an initialized client #when a child crashes during a call #then errors without replay and serves queued calls", () => {
		const f = fixture();
		initialize(f);
		send(f, { jsonrpc: "2.0", id: 2, method: "tools/call" });
		f.handle.requestRestart("build changed");
		childAt(f, 0).exit();
		expect(f.notifications).toHaveBeenCalledWith(
			"apple-cua",
			"Server restarted after a child crash (build changed); observe again before acting.",
		);
		expect(f.messages.at(-1)).toMatchObject({ id: 2, error: { code: -32000 } });
		send(f, { jsonrpc: "2.0", id: 3, method: "tools/list" });
		const second = childAt(f, 1);
		expect(second.messages).toHaveLength(1);
		reinitialize(second);
		expect(second.messages).toMatchObject([
			{ method: "initialize" },
			{ method: "notifications/initialized" },
			{ method: "tools/list" },
			{ id: 3, method: "tools/list" },
		]);
		expect(second.messages.some((message) => message["id"] === 2)).toBe(false);
		expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
		second.reply({ jsonrpc: "2.0", id: 3, result: { tools: [] } });
		expect(f.messages.at(-1)).toMatchObject({ id: 3, result: { tools: [] } });
		expect(f.messages.some((message) => typeof message["id"] === "string")).toBe(false);
	});

	it.each(["build-changed", "permission-granted"])(
		"#given an in-flight call #when %s triggers arrive repeatedly #then restart waits and coalesces",
		(reason) => {
			const f = fixture();
			initialize(f);
			send(f, { jsonrpc: "2.0", id: "call", method: "tools/call" });
			f.change(reason);
			f.handle.requestRestart(reason);
			const first = childAt(f, 0);
			expect(first.kills).toEqual([]);
			first.reply({ jsonrpc: "2.0", id: "call", result: {} });
			expect(first.kills).toEqual(["SIGTERM"]);
			f.change(reason);
			first.exit();
			f.change(reason);
			reinitialize(childAt(f, 1));
			expect(f.children).toHaveLength(2);
			expect(childAt(f, 1).kills).toEqual([]);
			expect(f.messages.some((message) => "error" in message)).toBe(false);
		},
	);

	it.each([
		[undefined, 15_000],
		["", 15_000],
		["   ", 15_000],
		["undefined", 15_000],
		["1.5", 15_000],
		["-1", 15_000],
		["0", 0],
		["250", 250],
	])("#given drain setting %s #when parsed #then uses %i milliseconds", async (value, expected) => {
		vi.useFakeTimers();
		vi.stubEnv("APPLE_CUA_SUPERVISOR_DRAIN_MS", value ?? "");
		try {
			const f = fixture();
			initialize(f);
			send(f, { jsonrpc: "2.0", id: "call", method: "tools/call" });
			f.handle.requestRestart("build-changed");
			if (expected === 15_000) {
				await vi.advanceTimersByTimeAsync(14_999);
				expect(f.messages.some((message) => message["id"] === "call")).toBe(false);
				expect(childAt(f, 0).kills).toEqual([]);
				await vi.advanceTimersByTimeAsync(1);
			} else {
				await vi.advanceTimersByTimeAsync(expected);
			}
			expect(f.messages.at(-1)).toMatchObject({
				id: "call",
				error: { message: expect.stringContaining("outcome is unknown") },
			});
			expect(childAt(f, 0).kills).toEqual(["SIGTERM"]);
			childAt(f, 0).exit();
			reinitialize(childAt(f, 1));
			expect(f.messages.at(-1)).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
			expect(childAt(f, 1).messages.some((message) => message["method"] === "tools/call")).toBe(false);
		} finally {
			vi.unstubAllEnvs();
			vi.useRealTimers();
		}
	});

	it("#given initialize capabilities #when the first result arrives #then tools advertise listChanged preserving other fields", () => {
		const f = fixture();
		send(f, { id: "init", method: "initialize" });
		childAt(f, 0).reply({
			jsonrpc: "2.0",
			id: "init",
			result: { serverInfo: { name: "test" }, capabilities: { resources: {}, tools: { custom: true } } },
		});
		expect(f.messages[0]).toMatchObject({
			result: {
				serverInfo: { name: "test" },
				capabilities: { resources: {}, tools: { custom: true, listChanged: true } },
			},
		});
		send(f, { id: "init-again", method: "initialize" });
		childAt(f, 0).reply({ id: "init-again", result: { capabilities: {} } });
		expect(f.messages.at(-1)).toEqual({ id: "init-again", result: { capabilities: {} } });
	});

	it("#given requests before initialize and reverse RPC #when proxied #then messages pass transparently", () => {
		const f = fixture();
		send(f, { id: null, method: "tools/list" });
		expect(childAt(f, 0).messages).toEqual([{ id: null, method: "tools/list" }]);
		childAt(f, 0).reply({ id: "server", method: "sampling/createMessage", params: {} });
		send(f, { id: "server", result: {} });
		expect(f.messages).toEqual([{ id: "server", method: "sampling/createMessage", params: {} }]);
		expect(childAt(f, 0).messages.at(-1)).toEqual({ id: "server", result: {} });
	});

	it("#given client input #when EOF arrives #then stdin ends child is killed and done resolves zero", async () => {
		const f = fixture();
		f.input.end();
		expect(await f.handle.done).toBe(0);
		expect(childAt(f, 0).stdin.writableEnded).toBe(true);
		expect(childAt(f, 0).kills).toEqual(["SIGTERM"]);
		expect(f.unsubscribed()).toBe(true);
		childAt(f, 0).exit();
		expect(f.children).toHaveLength(1);
	});

	it("#given repeated crashes during reinitialize #when limit is exceeded #then queued calls fail and done is one", async () => {
		const f = fixture(1);
		initialize(f);
		childAt(f, 0).exit();
		send(f, { id: 9, method: "tools/call" });
		childAt(f, 1).exit();
		expect(await f.handle.done).toBe(1);
		expect(f.messages.at(-1)).toMatchObject({ id: 9, error: { code: -32000 } });
		expect(f.logs.some((line) => line.includes("crash loop"))).toBe(true);
		expect(f.children).toHaveLength(2);
	});

	it("#given crashes outside the window #when the clock advances #then the old crashes do not exhaust the budget", () => {
		const f = fixture(1);
		childAt(f, 0).exit();
		f.setNow(60_001);
		childAt(f, 1).exit();
		expect(f.children).toHaveLength(3);
	});

	it("#given multiple in-flight calls #when the child exits #then every call receives one error", () => {
		const f = fixture();
		send(f, { id: "one", method: "tools/call" });
		send(f, { id: 2, method: "tools/call" });
		childAt(f, 0).exit();
		expect(f.messages.slice(0, 2)).toMatchObject([
			{ id: "one", error: { code: -32000 } },
			{ id: 2, error: { code: -32000 } },
		]);
	});
});

class FakeProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly kill = vi.fn(() => true);

	report(permissions: Record<string, boolean>): void {
		this.stdout.write(JSON.stringify({ permissions }));
		this.emit("close", 0);
	}
}

function nativeFixture(): {
	readonly processes: FakeProcess[];
	readonly events: ((event: string, filename: string | null) => void)[];
	readonly close: ReturnType<typeof vi.fn>;
} {
	native.spawn.mockReset();
	native.watch.mockReset();
	const processes: FakeProcess[] = [];
	const events: ((event: string, filename: string | null) => void)[] = [];
	const close = vi.fn();
	native.spawn.mockImplementation(() => {
		const process = new FakeProcess();
		processes.push(process);
		return process;
	});
	native.watch.mockImplementation((_path, listener) => {
		events.push(listener);
		return { close };
	});
	return { processes, events, close };
}

function processAt(processes: readonly FakeProcess[], index: number): FakeProcess {
	const process = processes[index];
	if (!process) throw new Error(`Missing process ${index}`);
	return process;
}

describe("node supervisor adapters with injected processes and fake timers", () => {
	it("#given watched build directories #when events settle for 1000ms #then one idle restart ignores maps", async () => {
		vi.useFakeTimers();
		const f = nativeFixture();
		const input = new PassThrough();
		const options = nodeSupervisorOptions("/repo/packages/mcp/dist/server.js", ["--lean"], SELF_CHECK_FLAG);
		const handle = startSupervisor({ ...options, input, output: new PassThrough(), log: () => undefined });
		try {
			expect(native.spawn).toHaveBeenNthCalledWith(
				1,
				process.execPath,
				["/repo/packages/mcp/dist/server.js", "--supervised-child", "--lean"],
				{ env: { ...process.env, APPLE_CUA_SUPERVISED: "1" }, stdio: ["pipe", "pipe", "inherit"] },
			);
			expect(native.watch.mock.calls.map(([path]) => path)).toEqual([
				"/repo/packages/mcp/dist",
				"/repo/packages/core/dist",
			]);
			processAt(f.processes, 1).report({ accessibility: true, screenRecording: true });
			for (const event of f.events) event("change", "server.js.map");
			await vi.advanceTimersByTimeAsync(1000);
			expect(processAt(f.processes, 0).kill).not.toHaveBeenCalled();
			f.events[0]?.("change", "server.js");
			await vi.advanceTimersByTimeAsync(700);
			f.events[1]?.("rename", "core.js");
			await vi.advanceTimersByTimeAsync(999);
			expect(processAt(f.processes, 0).kill).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(processAt(f.processes, 0).kill).toHaveBeenCalledTimes(1);
			expect(processAt(f.processes, 0).kill).toHaveBeenCalledWith("SIGTERM");
			processAt(f.processes, 0).emit("exit");
			expect(f.processes).toHaveLength(4);
		} finally {
			input.end();
			await handle.done;
			expect(f.close).toHaveBeenCalledTimes(2);
			expect(processAt(f.processes, 3).kill).toHaveBeenCalledWith("SIGTERM");
			expect(vi.getTimerCount()).toBe(0);
			vi.useRealTimers();
		}
	});

	it("#given a missing permission #when a 15000ms probe observes a grant #then the idle child restarts", async () => {
		vi.useFakeTimers();
		const f = nativeFixture();
		const notifications = vi.fn<(title: string, body: string) => void>();
		const input = new PassThrough();
		const handle = startSupervisor({
			...nodeSupervisorOptions("/repo/packages/mcp/dist/server.js", [], SELF_CHECK_FLAG),
			input,
			output: new PassThrough(),
			log: () => undefined,
			notify: notifications,
		});
		try {
			expect(native.spawn).toHaveBeenNthCalledWith(
				2,
				process.execPath,
				["/repo/packages/mcp/dist/server.js", SELF_CHECK_FLAG],
				{ env: { ...process.env, APPLE_CUA_SUPERVISED: "1" }, stdio: ["ignore", "pipe", "ignore"] },
			);
			processAt(f.processes, 1).report({ accessibility: false, screenRecording: true });
			await vi.advanceTimersByTimeAsync(14_999);
			expect(f.processes).toHaveLength(2);
			await vi.advanceTimersByTimeAsync(1);
			processAt(f.processes, 2).report({ accessibility: true, screenRecording: true });
			expect(notifications).toHaveBeenCalledWith("apple-cua", "Permissions granted; server reloading.");
			expect(processAt(f.processes, 0).kill).toHaveBeenCalledTimes(1);
			expect(processAt(f.processes, 0).kill).toHaveBeenCalledWith("SIGTERM");
			processAt(f.processes, 0).emit("exit");
			processAt(f.processes, 4).report({ accessibility: true, screenRecording: true });
			expect(vi.getTimerCount()).toBe(0);
			expect(f.processes).toHaveLength(5);
		} finally {
			input.end();
			await handle.done;
			vi.useRealTimers();
		}
	});
});
