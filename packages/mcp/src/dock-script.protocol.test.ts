import type { DockSnapshot, DockSource, HostCapabilities, StopStatus } from "@apple-cua/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import { createMcpServer } from "./server.js";

class MemoryTransport implements Transport {
	peer: MemoryTransport | undefined;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: <T extends JSONRPCMessage>(message: T) => void;
	async start(): Promise<void> {}
	async send(message: JSONRPCMessage): Promise<void> {
		queueMicrotask(() => this.peer?.onmessage?.(message));
	}
	async close(): Promise<void> {
		this.onclose?.();
	}
}

const host: HostCapabilities = {
	permissions: { accessibility: true, screenRecording: false },
	session: { screenLocked: false, onConsole: true },
	mainDisplay: { logical: { width: 1, height: 1 }, pixels: { width: 1, height: 1 } },
};
const dockElement = {
	id: 3,
	role: "AXDockItem",
	label: "Finder",
	value: null,
	actions: ["AXPress", "AXShowMenu", "AXCancel"],
	children: [],
	frame: { x: 1, y: 2, width: 3, height: 4 },
};

async function setup(
	options: {
		approved?: boolean;
		delivery?: "attended" | "background";
		stop?: boolean;
		changeOnAct?: boolean;
		duplicate?: boolean;
		actFailure?: boolean;
	} = {},
) {
	let generation = 0;
	let closed = false;
	let stopped = options.stop === true;
	let label = "Finder";
	const stopStatus = (): StopStatus =>
		stopped
			? { stopped: true, stoppedAt: "2026-10-13T00:00:00.000Z", reason: "test", source: "api" }
			: { stopped: false };
	const effects: string[] = [];
	let actionAttempts = 0;
	const snapshot = (): DockSnapshot => ({
		pid: 4242,
		observationKey: `dock:${generation}`,
		elements: [{ ...dockElement, label }, ...(options.duplicate === true ? [{ ...dockElement, id: 4 }] : [])],
		truncated: false,
	});
	const source: DockSource = {
		read: async () => {
			generation += 1;
			return snapshot();
		},
		act: async (before, id, action) => {
			actionAttempts += 1;
			if (before.pid !== 4242 || before.observationKey !== `dock:${generation}`)
				throw new Error("stale Dock generation");
			if (!before.elements.some((element) => element.id === id)) throw new Error("unknown Dock id");
			if (options.actFailure === true) throw new Error("injected Dock action failure");
			effects.push(`${id}:${action}`);
			if (options.changeOnAct === true) label = "Finder menu";
		},
	};
	const computer = new FakeGuardedComputer();
	Object.defineProperty(computer, "delivery", { value: options.delivery ?? "attended" });
	vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", options.approved === false ? "" : "com.apple.dock");
	const server = createMcpServer(
		computer,
		undefined,
		undefined,
		undefined,
		undefined,
		{
			status: stopStatus,
		},
		{
			toolset: "lean",
			dockSource: source,
			dockHostProbe: () => host,
		},
	);
	const client = new Client({ name: "dock-protocol-test", version: "1" });
	const a = new MemoryTransport();
	const b = new MemoryTransport();
	a.peer = b;
	b.peer = a;
	await Promise.all([server.connect(b), client.connect(a)]);
	return {
		client,
		effects,
		get actionAttempts() {
			return actionAttempts;
		},
		async close() {
			closed = true;
			stopped = true;
			await server.close();
		},
		get closed() {
			return closed;
		},
	};
}

async function call(harness: Awaited<ReturnType<typeof setup>>, code: string, read_only = false) {
	return await harness.client.callTool({ name: "run_script", arguments: { code, read_only } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payload(result: Awaited<ReturnType<typeof call>>): Record<string, unknown> {
	const content: unknown = result["content"];
	const text = Array.isArray(content)
		? content.find(
				(part: unknown): part is { type: "text"; text: string } =>
					typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part,
			)
		: undefined;
	if (text?.type !== "text") throw new Error("missing result text");
	const parsed: unknown = JSON.parse(text.text);
	if (!isRecord(parsed)) throw new Error("result payload is not an object");
	return parsed;
}

const live: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of live.splice(0)) await close();
	vi.unstubAllEnvs();
});

describe("run_script Dock handle", () => {
	it("resolves and acts on a unique query, returning observed frames and actions", async () => {
		const h = await setup();
		live.push(h.close);
		const result = await call(
			h,
			`const d=apple.dock(); const a=await d.click({label:"Finder"}); return await d.observe();`,
		);
		expect(result.isError).not.toBe(true);
		expect(payload(result)).toMatchObject({
			ok: true,
			value: { elements: [{ id: 3, frame: dockElement.frame, actions: dockElement.actions }], truncated: false },
		});
		expect(h.effects).toEqual(["3:AXPress"]);
	});

	it("requires an observation before ID actions", async () => {
		const h = await setup();
		live.push(h.close);
		const result = await call(h, "await apple.dock().click(3);");
		expect(result.isError).toBe(true);
		expect(payload(result)).toMatchObject({ failedAction: { status: "refused:needs-observation" } });
		expect(h.effects).toEqual([]);
	});

	it.each(["", "   ", "3.5", "-1"])("rejects malformed Dock ID %j without source dispatch", async (id) => {
		const h = await setup();
		live.push(h.close);
		const result = await call(h, `const d=apple.dock(); await d.observe(); await d.click(${JSON.stringify(id)});`);
		expect(result.isError).toBe(true);
		expect(payload(result)).toMatchObject({ failedAction: { status: "refused:invalid-argument" } });
		expect(h.effects).toEqual([]);
	});

	it("refuses ambiguous queries unless index disambiguates, with no input after refusal", async () => {
		const h = await setup({ duplicate: true });
		live.push(h.close);
		const result = await call(h, `await apple.dock().click({label:"Finder"});`);
		expect(result.isError).toBe(true);
		expect(payload(result)).toMatchObject({ failedAction: { status: "refused:dock-target-ambiguous" } });
		expect(h.effects).toEqual([]);
	});

	it("uses index to target the selected observed Dock id", async () => {
		const h = await setup({ duplicate: true });
		live.push(h.close);
		const result = await call(h, `await apple.dock().click({label:"Finder",index:1});`);
		expect(result.isError).not.toBe(true);
		expect(h.effects).toEqual(["4:AXPress"]);
	});

	it("revokes the cached Dock token after source action failure", async () => {
		const h = await setup({ actFailure: true });
		live.push(h.close);
		const result = await call(
			h,
			`
			const d=apple.dock();
			await d.observe();
			try { await d.click(3); } catch {}
			try { await d.click(3); } catch (error) { return error.refused; }
		`,
		);
		expect(result.isError).not.toBe(true);
		expect(payload(result)).toMatchObject({ ok: true, value: "needs-observation" });
		expect(h.effects).toEqual([]);
		expect(h.actionAttempts).toBe(1);
	});

	it("uses the guarded fresh generation after a changed action readback", async () => {
		const h = await setup({ changeOnAct: true });
		live.push(h.close);
		const result = await call(
			h,
			`
			const d=apple.dock();
			const first=await d.click({label:"Finder"});
			const next=await d.click({label:"Finder menu"});
			return {first:first.effect,next:next.effect};
		`,
		);
		expect(result.isError).not.toBe(true);
		expect(payload(result)).toMatchObject({ ok: true, value: { first: "observed_change", next: "unverifiable" } });
		expect(h.effects).toEqual(["3:AXPress", "3:AXPress"]);
	});

	it.each([
		{ name: "unapproved", approved: false, code: "await apple.dock().observe();" },
		{ name: "background", delivery: "background" as const, code: `await apple.dock().click({label:"Finder"});` },
		{ name: "read only", code: `await apple.dock().click({label:"Finder"});`, readOnly: true },
		{ name: "malformed", code: `await apple.dock().click({label:"Finder",extra:true});` },
	])("refuses $name without input", async ({ approved, delivery, code, readOnly }) => {
		const h = await setup({
			...(approved === undefined ? {} : { approved }),
			...(delivery === undefined ? {} : { delivery }),
		});
		live.push(h.close);
		const result = await call(h, code, readOnly);
		expect(result.isError).toBe(true);
		expect(h.effects).toEqual([]);
	});

	it("keeps Dock out of the catalog and refuses calls after stop or close", async () => {
		const h = await setup();
		live.push(h.close);
		const tools = await h.client.listTools();
		expect(tools.tools.map((tool) => tool.name)).not.toContain("dock");
		const stopped = await setup({ stop: true });
		live.push(stopped.close);
		expect((await call(stopped, "await apple.dock().observe();")).isError).toBe(true);
		await h.close();
		expect(h.closed).toBe(true);
		await h.client.close();
		await expect(call(h, "await apple.dock().observe();")).rejects.toThrow();
	});
});
