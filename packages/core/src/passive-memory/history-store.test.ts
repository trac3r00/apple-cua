import { describe, expect, it } from "bun:test";

import {
	DEFAULT_RETENTION_MS,
	type HistoryFs,
	HistorySegmentStore,
	SEGMENT_WINDOW_MS,
	segmentIdForTimestamp,
} from "./history-store.js";

function memoryFs(): HistoryFs & { files: Map<string, string>; dirs: Set<string> } {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	return {
		files,
		dirs,
		async ensureDir(path) {
			dirs.add(path);
		},
		async appendLine(path, line) {
			files.set(path, `${files.get(path) ?? ""}${line}\n`);
		},
		async writeText(path, text) {
			files.set(path, text);
		},
		async listDir(path) {
			const prefix = `${path}/`;
			return [...dirs]
				.filter((dir) => dir.startsWith(prefix))
				.map((dir) => dir.slice(prefix.length).split("/")[0] ?? "")
				.filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);
		},
		async removeDir(path) {
			dirs.delete(path);
			for (const key of [...files.keys()]) {
				if (key.startsWith(`${path}/`)) {
					files.delete(key);
				}
			}
		},
	};
}

const BASE = Date.parse("2026-10-29T04:03:00Z");

describe("#given a 10-minute window #when computing a segment id #then it floors to the window start", () => {
	it("floors 04:03 to 04:00", () => {
		expect(segmentIdForTimestamp(BASE)).toBe("2026-10-29T04-00-00Z");
	});
});

describe("#given an event #when appended #then it writes one JSONL line and segment metadata", () => {
	it("writes the event and a metadata.json with the count", async () => {
		const fs = memoryFs();
		const store = new HistorySegmentStore("/root", fs, () => BASE);
		await store.append({ id: 1, kind: "session.started", timestamp: "2026-10-29T04:03:00Z" });

		const events = fs.files.get("/root/segments/2026-10-29T04-00-00Z/events.jsonl");
		expect(events).toBe('{"id":1,"kind":"session.started","timestamp":"2026-10-29T04:03:00Z"}\n');
		const metadata = JSON.parse(fs.files.get("/root/segments/2026-10-29T04-00-00Z/metadata.json") ?? "{}");
		expect(metadata.eventCount).toBe(1);
		expect(metadata.startedAt).toBe("2026-10-29T04:00:00Z");
		expect(metadata.endedAt).toBe("2026-10-29T04:10:00Z");
	});
});

describe("#given a segment older than retention #when pruning #then it is removed and fresh ones kept", () => {
	it("removes a segment whose window ended before the cutoff", async () => {
		const fs = memoryFs();
		const store = new HistorySegmentStore("/root", fs, () => BASE, DEFAULT_RETENTION_MS);
		const oldTs = new Date(BASE - DEFAULT_RETENTION_MS - SEGMENT_WINDOW_MS).toISOString();
		await store.append({ id: 1, kind: "session.started", timestamp: oldTs });
		await store.append({ id: 2, kind: "session.started", timestamp: "2026-10-29T04:03:00Z" });

		const removed = await store.prune();

		expect(removed).toEqual([segmentIdForTimestamp(Date.parse(oldTs))]);
		expect(fs.files.has("/root/segments/2026-10-29T04-00-00Z/events.jsonl")).toBe(true);
	});
});

describe("#given a suppressed event #when recorded #then only the suppressed count rises", () => {
	it("increments suppressedEventCount without writing an event line", async () => {
		const fs = memoryFs();
		const store = new HistorySegmentStore("/root", fs, () => BASE);
		await store.recordSuppressed();

		const metadata = JSON.parse(fs.files.get("/root/segments/2026-10-29T04-00-00Z/metadata.json") ?? "{}");
		expect(metadata.suppressedEventCount).toBe(1);
		expect(metadata.eventCount).toBe(0);
		expect(fs.files.has("/root/segments/2026-10-29T04-00-00Z/events.jsonl")).toBe(false);
	});
});
