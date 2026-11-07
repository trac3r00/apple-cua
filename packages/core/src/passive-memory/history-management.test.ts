import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPaths } from "./history-control.js";
import { deleteHistorySegments, listHistorySegments, parseHistoryDuration } from "./history-management.js";

let stateDir: string;
let outside: string;

function event(app: string): string {
	return JSON.stringify({
		kind: "mouse.click",
		app: { name: app, bundleIdentifier: `x.${app}`, processIdentifier: 1 },
	});
}

async function segment(id: string, apps: readonly string[]): Promise<void> {
	const dir = join(historyPaths(stateDir).segmentsDir, id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "events.jsonl"), apps.map((app) => `${event(app)}\n`).join(""));
	await writeFile(join(dir, "metadata.json"), JSON.stringify({ id, eventCount: 999 }));
}

async function remaining(): Promise<string[]> {
	return (await readdir(historyPaths(stateDir).segmentsDir)).sort();
}

beforeEach(async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "opencua-history-management-")));
	stateDir = join(root, "state");
	outside = join(root, "outside");
	await mkdir(join(outside, "kept"), { recursive: true });
	await segment("2026-11-04T12-00-00Z", ["Notes", "Safari", "Safari"]);
	await segment("2026-11-04T12-10-00Z", ["Mail"]);
	await segment("2026-11-04T12-20-00Z", []);
	const segmentsDir = historyPaths(stateDir).segmentsDir;
	await symlink(outside, join(segmentsDir, "2026-11-04T11-50-00Z"));
	await mkdir(join(segmentsDir, "not-a-segment"));
	await writeFile(join(segmentsDir, "2026-11-04T11-40-00Z"), "a file, not a segment");
});

afterEach(async () => {
	await rm(join(stateDir, ".."), { recursive: true, force: true });
});

describe("#given recorded segments #when they are listed #then only real segment directories appear, newest first", () => {
	it("skips the symlink, the stray directory and the file, and summarizes what each segment holds", () => {
		const segments = listHistorySegments(historyPaths(stateDir));

		expect(segments.map((entry) => entry.id)).toEqual([
			"2026-11-04T12-20-00Z",
			"2026-11-04T12-10-00Z",
			"2026-11-04T12-00-00Z",
		]);
		expect(segments[2]).toEqual({
			id: "2026-11-04T12-00-00Z",
			startedAt: "2026-11-04T12:00:00.000Z",
			endedAt: "2026-11-04T12:10:00.000Z",
			eventCount: 3,
			apps: ["Safari", "Notes"],
		});
		expect(segments[0]?.eventCount).toBe(0);
	});

	it("returns nothing when history has never recorded", async () => {
		await rm(historyPaths(stateDir).segmentsDir, { recursive: true });

		expect(listHistorySegments(historyPaths(stateDir))).toEqual([]);
	});
});

describe("#given recorded segments #when some are deleted #then only the selected real directories go", () => {
	it("deletes exact ids and leaves siblings, the symlink and its target", async () => {
		const deleted = deleteHistorySegments(historyPaths(stateDir), { ids: ["2026-11-04T12-10-00Z"] });

		expect(deleted).toEqual(["2026-11-04T12-10-00Z"]);
		expect(await remaining()).toEqual([
			"2026-11-04T11-40-00Z",
			"2026-11-04T11-50-00Z",
			"2026-11-04T12-00-00Z",
			"2026-11-04T12-20-00Z",
			"not-a-segment",
		]);
		expect(await readdir(outside)).toEqual(["kept"]);
	});

	it.each(["../outside", "/tmp/outside", "2026-11-04T12-05-00Z", "not-a-segment", ""])(
		"refuses %j before deleting anything, even next to a valid id",
		async (bad) => {
			expect(() => deleteHistorySegments(historyPaths(stateDir), { ids: ["2026-11-04T12-00-00Z", bad] })).toThrow(
				/not a history segment id/,
			);
			expect(await remaining()).toContain("2026-11-04T12-00-00Z");
		},
	);

	it("refuses a symlink named like a segment and never touches what it points at", async () => {
		expect(() => deleteHistorySegments(historyPaths(stateDir), { ids: ["2026-11-04T11-50-00Z"] })).toThrow(
			/No history segment 2026-11-04T11-50-00Z/,
		);
		expect(await readdir(outside)).toEqual(["kept"]);
	});

	it("deletes every segment that overlaps the last period", async () => {
		const now = Date.parse("2026-11-04T12:25:00Z");

		const deleted = deleteHistorySegments(historyPaths(stateDir), { withinMs: 10 * 60_000 }, now);

		expect(deleted).toEqual(["2026-11-04T12-20-00Z", "2026-11-04T12-10-00Z"]);
		expect(await remaining()).toContain("2026-11-04T12-00-00Z");
	});

	it("deletes all segments but keeps whatever is not one", async () => {
		const deleted = deleteHistorySegments(historyPaths(stateDir), { all: true });

		expect(deleted).toHaveLength(3);
		expect(await remaining()).toEqual(["2026-11-04T11-40-00Z", "2026-11-04T11-50-00Z", "not-a-segment"]);
		expect(await readdir(outside)).toEqual(["kept"]);
	});
});

describe("#given a duration for --last #when it is parsed #then only whole minutes, hours or days are accepted", () => {
	it.each([
		["15m", 900_000],
		["2h", 7_200_000],
		["1d", 86_400_000],
	])("reads %s as %d ms", (text, ms) => {
		expect(parseHistoryDuration(text)).toBe(ms);
	});

	it.each(["0m", "1w", "", "-1h", "1.5h", "h"])("rejects %j", (text) => {
		expect(() => parseHistoryDuration(text)).toThrow(/is not a duration/);
	});
});
