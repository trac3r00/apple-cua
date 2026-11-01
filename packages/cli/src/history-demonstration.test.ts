import { afterEach, describe, expect, it } from "bun:test";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import {
	readHistoryDemonstrationEvidence,
	startHistoryDemonstration,
	stopHistoryDemonstration,
} from "./history-demonstration.js";

const roots: string[] = [];

function tempRoot(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-history-demonstration-")));
	roots.push(root);
	mkdirSync(join(root, "segments"));
	return root;
}

function setState(root: string, state: "running" | "paused" | "stopped"): void {
	writeFileSync(join(root, "state.json"), JSON.stringify({ state }));
}

function writeSegment(root: string, id: string, events: readonly Record<string, unknown>[]): void {
	const directory = join(root, "segments", id);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "metadata.json"),
		JSON.stringify({
			id,
			startedAt: "2026-10-29T04:00:00Z",
			endedAt: "2026-10-29T04:10:00Z",
			eventCount: events.length,
		}),
	);
	writeFileSync(join(directory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function segmentId(minute: string): string {
	return `2026-10-29T04-${minute}-00Z`;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("#given a running history recorder #when a demonstration starts #then only a boundary marker is created", () => {
	it("rounds start time to native event precision without changing recorder state", async () => {
		const root = tempRoot();
		setState(root, "running");

		const demonstration = await startHistoryDemonstration(root, Date.parse("2026-10-29T04:03:01.987Z"));

		expect(demonstration).toEqual({
			id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			startedAt: "2026-10-29T04:03:01.000Z",
			sourceIds: [],
		});
		expect(JSON.parse(readFileSync(join(root, "state.json"), "utf8"))).toEqual({ state: "running" });
		expect(lstatSync(join(root, "demonstrations", `${demonstration.id}.json`)).isFile()).toBe(true);
	});

	it("rejects paused and stopped recorder states", async () => {
		const root = tempRoot();
		for (const state of ["paused", "stopped"] as const) {
			setState(root, state);
			await expect(startHistoryDemonstration(root, Date.parse("2026-10-29T04:00:00Z"))).rejects.toThrow(
				"must be running",
			);
		}
	});
});

describe("#given a demonstration interval #when stopped #then intersecting segments are recorded", () => {
	it("selects intersecting segments and filters redacted evidence to the half-open boundaries", async () => {
		const root = tempRoot();
		setState(root, "running");
		const before = segmentId("00");
		const inside = segmentId("10");
		const after = segmentId("20");
		writeSegment(root, before, [{ kind: "mouse.click", timestamp: "2026-10-29T04:03:00.000Z" }]);
		writeSegment(root, inside, [
			{ kind: "mouse.click", timestamp: "2026-10-29T04:03:02.000Z", mouse: { operation: "click" } },
			{
				kind: "keyboard.text_input",
				timestamp: "2026-10-29T04:03:04.000Z",
				keyboard: { text: "secret" },
			},
			{ kind: "window.changed", timestamp: "2026-10-29T04:03:05.000Z" },
		]);
		writeSegment(root, after, [{ kind: "mouse.click", timestamp: "2026-10-29T04:03:06.000Z" }]);
		const demonstration = await startHistoryDemonstration(root, Date.parse("2026-10-29T04:03:01.200Z"));

		const stopped = await stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:03:04.100Z"));
		const evidence = await readHistoryDemonstrationEvidence(root, demonstration.id);

		expect(stopped).toEqual({
			...demonstration,
			endedAt: "2026-10-29T04:03:05.000Z",
			sourceIds: [after, inside, before],
		});
		expect(evidence).toContain('"kind":"mouse.click"');
		expect(evidence).toContain('"kind":"keyboard.text_input"');
		expect(evidence).not.toContain('"kind":"window.changed"');
		expect(evidence).not.toContain("secret");
	});

	it("selects timeline segments that overlap a demonstration's boundaries", async () => {
		const root = tempRoot();
		setState(root, "running");
		const overlap = segmentId("00");
		writeSegment(root, overlap, [{ kind: "mouse.click", timestamp: "2026-10-29T04:05:00.000Z" }]);
		const demonstration = await startHistoryDemonstration(root, Date.parse("2026-10-29T04:05:00Z"));

		const stopped = await stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:06:00Z"));

		expect(stopped.sourceIds).toEqual([overlap]);
	});

	it("reports empty meaningful selection explicitly", async () => {
		const root = tempRoot();
		setState(root, "running");
		const demonstration = await startHistoryDemonstration(root, Date.parse("2026-10-29T04:03:00Z"));
		await stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:03:00Z"));

		await expect(readHistoryDemonstrationEvidence(root, demonstration.id)).rejects.toThrow("no events");
	});
});

describe("#given invalid demonstration operations #when invoked #then invalid state is not persisted", () => {
	it("rejects invalid and malformed IDs, unknown IDs, and repeated stops", async () => {
		const root = tempRoot();
		setState(root, "running");
		const demonstration = await startHistoryDemonstration(root, Date.parse("2026-10-29T04:00:00Z"));
		const rejected = [
			() => stopHistoryDemonstration(root, "../escape", Date.parse("2026-10-29T04:01:00Z")),
			() => stopHistoryDemonstration(root, "not-a-uuid", Date.parse("2026-10-29T04:01:00Z")),
			() =>
				stopHistoryDemonstration(root, "00000000-0000-4000-8000-000000000000", Date.parse("2026-10-29T04:01:00Z")),
		];
		let executed = 0;
		for (const operation of rejected) {
			executed += 1;
			await expect(operation()).rejects.toThrow();
		}
		await stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:01:00Z"));
		await expect(
			stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:02:00Z")),
		).rejects.toThrow("already stopped");
		expect({ executed, discarded: 0 }).toEqual({ executed: 3, discarded: 0 });
	});

	it("rejects reversed times and durations beyond 90 minutes without stopping", async () => {
		const root = tempRoot();
		setState(root, "running");
		const started = Date.parse("2026-10-29T04:00:00Z");
		const demonstration = await startHistoryDemonstration(root, started);
		await expect(stopHistoryDemonstration(root, demonstration.id, started - 1)).rejects.toThrow("precede");
		await expect(stopHistoryDemonstration(root, demonstration.id, started + 90 * 60 * 1000 + 1)).rejects.toThrow(
			"90 minutes",
		);
		expect(JSON.parse(readFileSync(join(root, "demonstrations", `${demonstration.id}.json`), "utf8"))).toEqual(
			demonstration,
		);
	});
});

describe("#given unsafe marker paths #when inspected #then symlinks are rejected", () => {
	it("rejects symlinked demonstration directories and marker files", async () => {
		const root = tempRoot();
		const outside = tempRoot();
		setState(root, "running");
		const demonstration = await startHistoryDemonstration(root, Date.parse("2026-10-29T04:00:00Z"));
		const demonstrationPath = join(root, "demonstrations");
		const outsidePath = join(outside, "demonstrations");
		mkdirSync(outsidePath);
		rmSync(demonstrationPath, { recursive: true });
		symlinkSync(outsidePath, demonstrationPath);
		await expect(
			stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:01:00Z")),
		).rejects.toThrow("real directory");

		rmSync(demonstrationPath);
		mkdirSync(demonstrationPath);
		const outsideMarker = join(outsidePath, `${demonstration.id}.json`);
		writeFileSync(outsideMarker, readFileSync(join(root, "state.json")));
		symlinkSync(outsideMarker, join(demonstrationPath, `${demonstration.id}.json`));
		await expect(
			stopHistoryDemonstration(root, demonstration.id, Date.parse("2026-10-29T04:01:00Z")),
		).rejects.toThrow("marker file");
	});
});

describe("#given generated event families #when evidence is filtered #then calibration remains exact", () => {
	it("replays every generated operation and date boundary without discarded cases", async () => {
		const root = tempRoot();
		setState(root, "running");
		const id = segmentId("00");
		const kinds = ["mouse.click", "keyboard.shortcut", "window.changed", "selection.changed"];
		const timestamps = [
			"2026-10-29T04:03:00.000Z",
			"2026-10-29T04:03:01.000Z",
			"2026-10-29T04:03:02.000Z",
			"2026-10-29T04:03:03.000Z",
		] as const;
		writeSegment(
			root,
			id,
			kinds.map((kind, index) => ({ kind, timestamp: timestamps[index] })),
		);
		const demonstration = await startHistoryDemonstration(root, Date.parse(timestamps[1]));
		await stopHistoryDemonstration(root, demonstration.id, Date.parse(timestamps[3]));

		const lines = (await readHistoryDemonstrationEvidence(root, demonstration.id))
			.split("\n")
			.filter((line) => line.startsWith("{"));
		const attempted = kinds.length;
		let executed = 0;
		const actual = lines.map((line) => z.object({ kind: z.string() }).parse(JSON.parse(line)).kind);
		for (const [index, kind] of kinds.entries()) {
			expect(actual.includes(kind), kind).toBe(index === 1 || index === 2);
			executed++;
		}
		expect({ attempted, executed, discarded: 0 }).toEqual({
			attempted: 4,
			executed: 4,
			discarded: 0,
		});
	});
});
