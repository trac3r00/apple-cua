import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import type { HotFrameWorker } from "./hot-frames.js";
import { HotFrameSource } from "./hot-frames.js";

const sources: HotFrameSource[] = [];

afterEach(() => {
	for (const source of sources.splice(0)) {
		source.dispose();
	}
});

interface TestWorker extends HotFrameWorker {
	deliver(message: unknown): void;
}

function fakeWorker(): TestWorker {
	const listeners = new Map<string, (payload?: unknown) => void>();
	return {
		on: (event, callback) => {
			listeners.set(event, callback as (payload?: unknown) => void);
		},
		postMessage: () => undefined,
		terminate: async () => undefined,
		deliver: (message) => listeners.get("message")?.(message),
	};
}

describe("#given JPEG bytes #when hot frames are delivered #then hashes are stable and content-specific", () => {
	it("preserves the hash for identical bytes and distinguishes different bytes", () => {
		const worker = fakeWorker();
		const source = new HotFrameSource({ spawnWorker: () => worker, idleStopMs: 60_000 });
		sources.push(source);
		source.start(1234, 71, { width: 1000, height: 800 });
		const firstBytes = Buffer.from("first-jpeg");
		const secondBytes = Buffer.from("second-jpeg");
		const hash = (bytes: Buffer): string => createHash("sha1").update(bytes).digest("hex");

		worker.deliver({ type: "frame", bytes: new Uint8Array(firstBytes), hash: hash(firstBytes) });
		const firstHash = source.latestFor(1234, 71)?.hash;
		worker.deliver({ type: "frame", bytes: new Uint8Array(firstBytes), hash: hash(firstBytes) });
		const repeatedHash = source.latestFor(1234, 71)?.hash;
		worker.deliver({ type: "frame", bytes: new Uint8Array(secondBytes), hash: hash(secondBytes) });
		const changedHash = source.latestFor(1234, 71)?.hash;

		expect(firstHash).toBeDefined();
		expect(repeatedHash).toBe(firstHash);
		expect(changedHash).not.toBe(firstHash);
	});
});
