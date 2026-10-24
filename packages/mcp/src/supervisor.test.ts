import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineFramer, nodeSupervisorOptions, startSupervisor } from "./supervisor.js";

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

function reinitialize(child: FakeChild): void {
	const message = child.messages[0];
	expect(message).toMatchObject({ method: "initialize", params: { protocolVersion: "2025-03-26" } });
	child.reply({ jsonrpc: "2.0", id: message?.["id"], result: { capabilities: {} } });
}

afterEach(async () => {
	for (const f of fixtures.splice(0)) {
		f.input.end();
		await f.handle.done;
	}
});

describe("stdio supervisor", () => {
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
		send(f, { id: null, method: "ping" });
		expect(childAt(f, 0).messages).toEqual([{ id: null, method: "ping" }]);
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
