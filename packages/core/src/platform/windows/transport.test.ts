import { afterEach, describe, expect, it } from "bun:test";
import { gunzipSync } from "node:zlib";
import { vi } from "@opencua/test-support";
import { PowerShellTransport, type WindowsProcessFactory } from "./transport.js";

interface ProcessFixture {
	readonly executable: string;
	readonly args: readonly string[];
	readonly lines: string[];
	readonly receive: (line: string) => void;
	readonly exit: (reason: string, missing: boolean) => void;
	killed: boolean;
}

function fixture(options: { physical?: boolean; allowWmChar?: boolean; timeoutMs?: number } = {}) {
	const processes: ProcessFixture[] = [];
	const factory: WindowsProcessFactory = (executable, args, receive, exit) => {
		const process: ProcessFixture = { executable, args, receive, exit, lines: [], killed: false };
		processes.push(process);
		return {
			write(line: string) {
				process.lines.push(line);
			},
			kill() {
				process.killed = true;
			},
		};
	};
	const transport = new PowerShellTransport({ ...options, processFactory: factory });
	transports.push(transport);
	function process(index = 0): ProcessFixture {
		const result = processes[index];
		if (!result) throw new Error("Missing fixture process");
		return result;
	}
	function requestId(p: ProcessFixture, index = 0): number {
		const raw: unknown = JSON.parse(p.lines[index] ?? "");
		if (typeof raw !== "object" || raw === null || !("id" in raw) || typeof raw.id !== "number") {
			throw new Error("Invalid wire request");
		}
		return raw.id;
	}
	return { transport, processes, process, requestId };
}

const transports: PowerShellTransport[] = [];
function outcome(response: Promise<unknown>) {
	return response.then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);
}

afterEach(async () => {
	for (const transport of transports.splice(0)) await transport.close();
	vi.useRealTimers();
});

describe("PowerShell JSONL host", () => {
	it("#given simultaneous requests #when responses arrive reversed #then correlates ids on one persistent process", async () => {
		const { transport, processes, process, requestId } = fixture();
		const first = transport.request("screen");
		const second = transport.request("listApps");
		const p = process();
		p.receive(JSON.stringify({ id: requestId(p, 1), result: ["app"] }));
		p.receive(JSON.stringify({ id: requestId(p), result: { width: 1920, height: 1080 } }));
		expect(await first).toEqual({ width: 1920, height: 1080 });
		expect(await second).toEqual(["app"]);
		expect(processes).toHaveLength(1);
		expect(p.executable).toBe("pwsh");
	});

	it("#given no pwsh executable #when starting #then falls back to Windows PowerShell", async () => {
		const { transport, process, requestId } = fixture();
		const response = transport.request("screen");
		const concurrent = transport.request("listApps");
		process().exit("ENOENT", true);
		const fallback = process(1);
		fallback.receive(JSON.stringify({ id: requestId(fallback), result: 1 }));
		fallback.receive(JSON.stringify({ id: requestId(fallback, 1), result: [] }));
		expect(await response).toBe(1);
		expect(await concurrent).toEqual([]);
		expect(fallback.executable).toBe("powershell.exe");
		process().exit("late exit from missing pwsh", false);
		expect(fallback.killed).toBe(false);
	});

	it("#given neither executable exists #when starting #then reports a clear host error", async () => {
		const { transport, process } = fixture();
		const response = transport.request("screen");
		const rejection = outcome(response);
		process().exit("pwsh ENOENT", true);
		process(1).exit("powershell.exe ENOENT", true);
		expect(await rejection).toMatchObject({ error: { code: "HOST_EXITED" } });
	});

	it("#given an expired deadline #when the timer fires #then rejects all requests and restarts only on next use", async () => {
		vi.useFakeTimers();
		const { transport, process, processes, requestId } = fixture({ timeoutMs: 50 });
		const response = transport.request("action", { action: "press" });
		const rejection = outcome(response);
		await vi.advanceTimersByTimeAsync(50);
		expect(await rejection).toMatchObject({ error: { code: "TIMEOUT" } });
		expect(process().killed).toBe(true);
		expect(processes).toHaveLength(1);
		const next = transport.request("snapshot");
		const fresh = process(1);
		fresh.receive(JSON.stringify({ id: requestId(fresh), result: "fresh" }));
		expect(await next).toBe("fresh");
		expect(fresh.lines).toHaveLength(1);
	});

	it("#given a crashing host #when it exits #then rejects in-flight work and ignores obsolete responses", async () => {
		const { transport, process, requestId } = fixture();
		const response = transport.request("action");
		const rejection = outcome(response);
		process().exit("crash", false);
		expect(await rejection).toMatchObject({
			error: { code: "HOST_EXITED", message: expect.stringContaining("crash") },
		});
		const generation = transport.generation;
		const next = transport.request("snapshot");
		const fresh = process(1);
		process().receive(JSON.stringify({ id: requestId(fresh), result: "obsolete" }));
		fresh.receive(JSON.stringify({ id: requestId(fresh), result: "fresh" }));
		expect(await next).toBe("fresh");
		expect(transport.generation).toBeGreaterThan(generation);
	});

	it.each([
		"garbage",
		JSON.stringify({ id: "not-numeric", result: 1 }),
		JSON.stringify({ missing: true }),
		JSON.stringify({ id: 1 }),
		JSON.stringify({ id: 1, error: { code: 5 } }),
	])("#given malformed output %s #when decoding #then rejects and discards the helper", async (line) => {
		const { transport, process } = fixture();
		const response = transport.request("screen");
		const rejection = outcome(response);
		process().receive(line);
		expect(await rejection).toMatchObject({ error: { code: "PROTOCOL" } });
		expect(process().killed).toBe(true);
	});

	it("#given a stale UIA ref #when an error arrives #then preserves its error code without restarting", async () => {
		const { transport, process, requestId, processes } = fixture();
		const response = transport.request("action");
		const rejection = outcome(response);
		process().receive(
			JSON.stringify({ id: requestId(process()), error: { code: "STALE_REF", message: "RuntimeId changed" } }),
		);
		expect(await rejection).toMatchObject({ error: { code: "STALE_REF" } });
		expect(process().killed).toBe(false);
		expect(processes).toHaveLength(1);
	});

	it("#given a closed client #when requesting #then refuses without spawning another host", async () => {
		const { transport, processes } = fixture();
		await transport.close();
		await expect(transport.request("screen")).rejects.toMatchObject({ code: "CLOSED" });
		expect(processes).toHaveLength(0);
	});

	it("#given pending work #when closing #then rejects it and terminates its process", async () => {
		const { transport, process } = fixture();
		const response = transport.request("screen");
		const rejection = outcome(response);
		await transport.close();
		expect(await rejection).toMatchObject({ error: { code: "CLOSED" } });
		expect(process().killed).toBe(true);
	});

	it.each([false, true])(
		"#given physical opt-in %s #when launching #then encodes that policy in the shipped helper",
		async (physical) => {
			const { transport, process, requestId } = fixture({ physical });
			const response = transport.request("screen");
			const p = process();
			const encoded = p.args.at(-1);
			if (!encoded) throw new Error("Missing encoded command");
			expect(encoded.length).toBeLessThan(30_000);
			const bootstrap = Buffer.from(encoded, "base64").toString("utf16le");
			const packed = /FromBase64String\('([^']+)'\)/u.exec(bootstrap)?.[1];
			if (!packed) throw new Error("Missing compressed helper");
			const script = gunzipSync(Buffer.from(packed, "base64")).toString("utf8");
			expect(script.startsWith(`$PhysicalAllowed=$${physical}; $WmCharAllowed=$false;`)).toBe(true);
			p.receive(JSON.stringify({ id: requestId(p), result: null }));
			await response;
		},
	);
});
