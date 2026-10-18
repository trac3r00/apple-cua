import type { DockSnapshot, DockSource, HostCapabilities, StopStatus, StopStatusSource } from "@apple-cua/core";
import { describe, expect, it, vi } from "vitest";
import { DockGuardSession } from "./dock-session.js";
import type { ToolResult } from "./tool-result.js";

const DOCK_ITEM = {
	id: 3,
	role: "AXDockItem",
	label: "Finder",
	value: null,
	actions: ["AXPress", "AXShowMenu"],
	children: [],
	frame: { x: 0, y: 0, width: 0, height: 0 },
};

const SNAPSHOT: DockSnapshot = {
	pid: 4242,
	observationKey: "dock:1",
	elements: [DOCK_ITEM],
	truncated: false,
};

const HOST: HostCapabilities = {
	permissions: { accessibility: true, screenRecording: false },
	session: { screenLocked: false, onConsole: true },
	mainDisplay: { logical: { width: 1, height: 1 }, pixels: { width: 1, height: 1 } },
};

class MutableStop implements StopStatusSource {
	state: StopStatus = { stopped: false };
	status(): StopStatus { return this.state; }
}

class Deferred<T> {
	readonly promise: Promise<T>;
	resolve!: (value: T) => void;
	constructor() {
		this.promise = new Promise((resolve) => { this.resolve = resolve; });
	}
}

function resultText(result: ToolResult): string {
	const content = result.content[0];
	if (content?.type !== "text") throw new Error("expected text result");
	return content.text;
}

function setup(overrides: {
	readonly delivery?: "background" | "attended";
	readonly allowedBundleIds?: readonly string[];
	readonly host?: HostCapabilities;
	readonly stopSwitch?: StopStatusSource;
	readonly source?: DockSource;
	readonly now?: () => number;
	readonly ttlMs?: number;
} = {}) {
	let current = SNAPSHOT;
	let generation = 0;
	const read = vi.fn(async () => ({ ...current, observationKey: `dock:${++generation}` }));
	const act = vi.fn(async () => undefined);
	const source = overrides.source ?? { read, act };
	const session = new DockGuardSession(source, {
		allowedBundleIds: overrides.allowedBundleIds ?? ["com.apple.dock"],
		delivery: overrides.delivery ?? "attended",
		probeHost: () => overrides.host ?? HOST,
		...(overrides.stopSwitch === undefined ? {} : { stopSwitch: overrides.stopSwitch }),
		...(overrides.now === undefined ? {} : { now: overrides.now }),
		...(overrides.ttlMs === undefined ? {} : { ttlMs: overrides.ttlMs }),
	});
	return {
		session,
		read,
		act,
		setSnapshot(snapshot: DockSnapshot) { current = snapshot; },
	};
}

async function observeToken(session: DockGuardSession): Promise<string> {
	const match = /"observation_token":\s*"([^"]+)"/.exec(resultText(await session.observe()));
	if (match?.[1] === undefined) throw new Error("observation token missing");
	return match[1];
}

describe("DockGuardSession", () => {
	it("returns real elements only while their observation token is live", async () => {
		const { session } = setup();
		const token = await observeToken(session);
		expect(session.observedElements(token)).toBe(SNAPSHOT.elements);
		expect(session.observedElements("missing")).toBeUndefined();
		await session.act(token, 3, "AXPress");
		expect(session.observedElements(token)).toBeUndefined();
	});

	it("requires Dock approval before any observation", async () => {
		const { session, read } = setup({ allowedBundleIds: [] });
		const result = await session.observe();
		expect(result.isError).toBe(true);
		expect(read).not.toHaveBeenCalled();
	});

	it.each([
		{ name: "locked", host: { ...HOST, session: { screenLocked: true, onConsole: true } } },
		{ name: "off-console", host: { ...HOST, session: { screenLocked: false, onConsole: false } } },
		{ name: "unknown console", host: { ...HOST, session: { screenLocked: false, onConsole: undefined } } },
		{ name: "no Accessibility", host: { ...HOST, permissions: { ...HOST.permissions, accessibility: false } } },
	])("refuses unsafe host state ($name)", async ({ name, host }) => {
		const { session, read, act } = setup({ host });
		if (name === "locked" || name === "no Accessibility") {
			expect((await session.observe()).isError).toBe(true);
			expect(read).not.toHaveBeenCalled();
		} else {
			const token = await observeToken(session);
			expect((await session.act(token, 3, "AXPress")).isError).toBe(true);
			expect(act).not.toHaveBeenCalled();
		}
	});

	it("rejects missing, expired, reused, and invalidated tokens", async () => {
		let now = 100;
		const { session } = setup({ now: () => now, ttlMs: 5 });
		expect((await session.act("missing", 3, "AXPress")).isError).toBe(true);
		const expired = await observeToken(session);
		now += 5;
		expect((await session.act(expired, 3, "AXPress")).isError).toBe(true);
		now += 1;
		const token = await observeToken(session);
		expect((await session.act(token, 3, "AXPress")).isError).not.toBe(true);
		expect((await session.act(token, 3, "AXPress")).isError).toBe(true);
	});

	it("consumes authority on a refused background action", async () => {
		const { session, act } = setup({ delivery: "background" });
		const token = await observeToken(session);
		const refused = await session.act(token, 3, "AXPress");
		expect(refused.isError).toBe(true);
		expect(act).not.toHaveBeenCalled();
		expect((await session.act(token, 3, "AXPress")).isError).toBe(true);
	});

	it("requires an observed supported role and advertised action", async () => {
		const { session, act } = setup();
		const token = await observeToken(session);
		expect((await session.act(token, 3, "AXCancel")).isError).toBe(true);
		expect(act).not.toHaveBeenCalled();
	});

	it.each(["pid", "observation key"])("delegates changed %s validation to DockSource.act", async (changed) => {
		let pid = SNAPSHOT.pid;
		let observationKey = SNAPSHOT.observationKey;
		let reads = 0;
		const act = vi.fn(async (snapshot: DockSnapshot) => {
			if (snapshot.pid !== pid || snapshot.observationKey !== observationKey)
				throw new Error("Dock identity changed");
		});
		const source: DockSource = {
			read: async () => {
				reads += 1;
				return { ...SNAPSHOT, pid, observationKey };
			},
			act,
		};
		const { session } = setup({ source });
		const token = await observeToken(session);
		if (changed === "pid") pid += 1;
		else observationKey = "dock:changed";
		const failed = await session.act(token, 3, "AXPress");
		const result = resultText(failed);
		expect(failed.isError).toBe(true);
		expect(act).toHaveBeenCalledWith(
			expect.objectContaining({ pid: SNAPSHOT.pid, observationKey: SNAPSHOT.observationKey }),
			3,
			"AXPress",
		);
		expect(reads).toBe(1);
		expect(result).toContain("Dock identity changed");
		expect(result).toContain('"effect":"unverifiable"');
	});

	it("serializes concurrent observation and action calls", async () => {
		const gate = new Deferred<void>();
		let generation = 0;
		const source: DockSource = {
			read: vi.fn(async () => {
				await gate.promise;
				generation += 1;
				return { ...SNAPSHOT, observationKey: `dock:${generation}` };
			}),
			act: vi.fn(async () => undefined),
		};
		const { session } = setup({ source });
		const observing = session.observe();
		const acting = session.act("not-issued-yet", 3, "AXPress");
		gate.resolve(undefined);
		expect((await observing).isError).not.toBe(true);
		expect((await acting).isError).toBe(true);
	});

	it("reports unchanged outcomes as unverifiable and never confirms dispatch", async () => {
		const { session, act } = setup();
		const token = await observeToken(session);
		const result = resultText(await session.act(token, 3, "AXPress"));
		expect(act).toHaveBeenCalledWith(expect.objectContaining({ observationKey: "dock:1" }), 3, "AXPress");
		expect(result).toMatch(/"actionDispatched"\s*:\s*true/);
		expect(result).toMatch(/"effect"\s*:\s*"unverifiable"/);
		expect(result).toMatch(/"route"\s*:\s*"accessibility"/);
		expect(result).toMatch(/"delivery"\s*:\s*"attended"/);
		expect(result).toMatch(/"observation_token"\s*:/);
		expect(result).not.toMatch(/"effect"\s*:\s*"confirmed"/);
	});

	it("reports changed element facts and issues fresh continuation authority", async () => {
		let generation = 0;
		const source: DockSource = {
			read: async () => ({
				...SNAPSHOT,
				observationKey: `dock:${++generation}`,
				elements: generation === 1
					? SNAPSHOT.elements
					: [{ ...DOCK_ITEM, label: "Finder menu" }],
			}),
			act: vi.fn(async () => undefined),
		};
		const { session } = setup({ source });
		const token = await observeToken(session);
		const result = resultText(await session.act(token, 3, "AXPress"));
		expect(result).toMatch(/"effect"\s*:\s*"observed_change"/);
		expect(result).toMatch(/"observation_token"\s*:/);
	});

	it("replaces authority on observation and accepts only the newest token", async () => {
		const { session, act } = setup();
		const stale = await observeToken(session);
		const current = await observeToken(session);
		expect((await session.act(stale, 3, "AXPress")).isError).toBe(true);
		expect(act).not.toHaveBeenCalled();
		expect((await session.act(current, 3, "AXPress")).isError).not.toBe(true);
		expect(act).toHaveBeenCalledTimes(1);
	});

	it("stop changes during an awaited observation prevent authority issuance", async () => {
		const stop = new MutableStop();
		const gate = new Deferred<void>();
		const entered = new Deferred<void>();
		const source: DockSource = {
			read: async () => {
				entered.resolve(undefined);
				await gate.promise;
				return { ...SNAPSHOT, observationKey: "dock:fresh" };
			},
			act: vi.fn(async () => undefined),
		};
		const { session } = setup({ source, stopSwitch: stop });
		const observing = session.observe();
		await entered.promise;
		stop.state = { stopped: true, stoppedAt: "2026-01-01T00:00:00.000Z", reason: "test", source: "api" };
		gate.resolve(undefined);
		expect((await observing).isError).toBe(true);
		expect(source.act).not.toHaveBeenCalled();
	});

	it("close and invalidate revoke outstanding authority", async () => {
		const { session, act } = setup();
		const token = await observeToken(session);
		session.invalidate();
		expect((await session.act(token, 3, "AXPress")).isError).toBe(true);
		const next = await observeToken(session);
		session.close();
		expect((await session.act(next, 3, "AXPress")).isError).toBe(true);
		expect(act).not.toHaveBeenCalled();
	});
});
