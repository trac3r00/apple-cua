import { afterEach, describe, expect, it } from "bun:test";
import type { DockSnapshot, DockSource, HostCapabilities, MenuExtraSnapshot, StopStatus } from "@apple-cua/core";
import { vi } from "@apple-cua/test-support";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";
import { createMcpServer } from "./server.js";

class MemoryTransport implements Transport {
	peer: MemoryTransport | undefined;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: <T extends JSONRPCMessage>(message: T) => void;
	async start(): Promise<void> {
		return;
	}
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
		terminalApproved?: boolean;
		terminalDelivery?: "attended" | "background";
		extrasApproved?: boolean;
		expireToken?: boolean;
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
	const terminalCommands: string[] = [];
	let extrasActions = 0;
	let clock = 0;
	const extrasSnapshot: MenuExtraSnapshot = {
		pid: 9001,
		observationKey: "extras:1",
		items: [
			{
				id: 17,
				role: "AXStatusBarItem",
				label: "Wi-Fi",
				value: null,
				frame: { x: 0, y: 0, width: 20, height: 20 },
				actions: ["AXPress"],
				children: [],
			},
		],
		truncated: false,
	};
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
	Object.defineProperty(computer, "delivery", {
		value: options.terminalDelivery ?? options.delivery ?? "attended",
	});
	vi.stubEnv(
		"APPLE_CUA_ALLOWED_BUNDLE_IDS",
		options.terminalApproved === true
			? "com.apple.dock,com.apple.Terminal,com.apple.controlcenter"
			: options.approved === false
				? ""
				: `com.apple.dock${options.extrasApproved === true ? ",com.apple.controlcenter" : ""}`,
	);
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
			terminalHostProbe: () => host,
			terminalDispatch: async (command) => {
				terminalCommands.push(command);
				return { dispatched: true, marker: `apple-cua-marker-${command.length}` };
			},
			terminalRead: () => "visible terminal output",
			extrasSource: {
				read: async () => extrasSnapshot,
				act: async (_snapshot, id) => {
					if (id !== 17) throw new Error("unexpected menu extra");
					extrasActions += 1;
				},
			},
			extrasHostProbe: () => host,
			extrasNow: () => {
				const current = clock;
				clock += options.expireToken === true ? 120_001 : 1;
				return current;
			},
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
		terminalCommands,
		get extrasActions() {
			return extrasActions;
		},
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
	const text = Array.isArray(content) ? content.find((part) => isRecord(part) && part["type"] === "text") : undefined;
	if (!isRecord(text) || text["type"] !== "text" || typeof text["text"] !== "string") {
		throw new Error("missing result text");
	}
	const parsed: unknown = JSON.parse(text["text"]);
	if (!isRecord(parsed)) throw new Error("result payload is not an object");
	return parsed;
}

const live: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of live.splice(0)) await close();
	vi.unstubAllEnvs();
});

describe("run_script Dock handle", () => {
	it("#given spaces APIs are read-only #when queried #then active and display data return", async () => {
		const h = await setup();
		live.push(h.close);
		const result = await call(
			h,
			"return {active:await apple.spaces().active(),displays:await apple.spaces().displays()};",
			true,
		);
		expect(result.isError).not.toBe(true);
		const value = payload(result)["value"];
		expect(isRecord(value)).toBe(true);
		if (!isRecord(value)) throw new Error("spaces result is not an object");
		expect(isRecord(value["active"])).toBe(true);
		expect(Array.isArray(value["displays"])).toBe(true);
		if (!isRecord(value["active"])) throw new Error("active space result is not an object");
		expect(
			value["active"]["activeSpaceId"] === undefined || typeof value["active"]["activeSpaceId"] === "number",
		).toBe(true);
	});

	it("#given an allowlisted menu extra #when observed and pressed #then the observed AXPress dispatches", async () => {
		const h = await setup({ extrasApproved: true });
		live.push(h.close);
		const result = await call(
			h,
			"const m=apple.menubar();const o=await m.observe();return await m.press(o.items[0].id);",
		);
		expect(result.isError).not.toBe(true);
		expect(h.extrasActions).toBe(1);
	});

	it("#given no fresh token #when a menu extra is pressed #then no action dispatches", async () => {
		const h = await setup({ extrasApproved: true });
		live.push(h.close);
		const result = await call(h, "await apple.menubar().press(17);");
		expect(result.isError).toBe(true);
		expect(h.extrasActions).toBe(0);
	});

	it("#given a stale token #when a menu extra is pressed #then no action dispatches", async () => {
		const h = await setup({ extrasApproved: true, expireToken: true });
		live.push(h.close);
		const result = await call(
			h,
			"const m=apple.menubar();const o=await m.observe();return await m.press(o.items[0].id);",
		);
		expect(result.isError).toBe(true);
		expect(h.extrasActions).toBe(0);
	});

	it("#given Control Center is not allowlisted #when observed #then policy refuses", async () => {
		const h = await setup();
		live.push(h.close);
		const result = await call(h, "await apple.menubar().observe();");
		expect(result.isError).toBe(true);
		expect(h.extrasActions).toBe(0);
	});

	it("#given read_only mode #when menu extra press is attempted #then it is refused", async () => {
		const h = await setup({ extrasApproved: true });
		live.push(h.close);
		const result = await call(
			h,
			"const m=apple.menubar();const o=await m.observe();return await m.press(o.items[0].id);",
			true,
		);
		expect(result.isError).toBe(true);
		expect(h.extrasActions).toBe(0);
	});

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

	it("#given Terminal.app is allowlisted #when terminal.run and read execute #then dispatch marker and visible text return", async () => {
		const h = await setup({ terminalApproved: true });
		live.push(h.close);
		expect(process.env["APPLE_CUA_ALLOWED_BUNDLE_IDS"]).toContain("com.apple.Terminal");
		const result = await call(
			h,
			`const t=apple.terminal(); const run=await t.run("echo hi"); const text=await t.read(); return {run,text};`,
		);
		expect(result.isError, JSON.stringify(payload(result))).not.toBe(true);
		expect(payload(result)).toMatchObject({
			ok: true,
			value: {
				run: { dispatched: true, marker: "apple-cua-marker-7" },
				text: "visible terminal output",
			},
		});
		expect(h.terminalCommands).toEqual(["echo hi"]);
	});

	it("#given Terminal.app is not allowlisted #when terminal.run is called #then the mutation is refused", async () => {
		const h = await setup();
		live.push(h.close);
		const result = await call(h, `await apple.terminal().run("echo must-not-run");`);
		expect(result.isError).toBe(true);
		expect(payload(result)).toMatchObject({
			ok: false,
			error: expect.stringContaining("com.apple.Terminal"),
		});
		expect(h.terminalCommands).toEqual([]);
	});
});
