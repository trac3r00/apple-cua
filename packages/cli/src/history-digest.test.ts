import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	digestLatestHistory,
	historyAutomationEnabled,
	listHistoryDigests,
	setHistoryAutomation,
} from "./history-digest.js";

const roots: string[] = [];
const segmentId = "2026-10-29T04-00-00Z";

function tempRoot(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-history-digest-")));
	roots.push(root);
	return root;
}

function writeSegment(root: string, id = segmentId, endedAt = "2026-10-29T04:10:00Z"): void {
	const directory = join(root, "segments", id);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "metadata.json"),
		JSON.stringify({
			id,
			startedAt: "2026-10-29T04:00:00Z",
			endedAt,
			eventCount: 1,
		}),
	);
	writeFileSync(
		join(directory, "events.jsonl"),
		`${JSON.stringify({
			kind: "mouse.click",
			timestamp: "2026-10-29T04:03:00Z",
			app: { name: "Finder" },
		})}\n`,
	);
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("#given history automation #when checking consent #then only explicit settings enable it", () => {
	it("defaults to disabled and persists opt-in", async () => {
		const root = tempRoot();
		expect(await historyAutomationEnabled(join(root, "missing"))).toBe(false);
		expect(await historyAutomationEnabled(root)).toBe(false);
		await setHistoryAutomation(root, true);
		expect(await historyAutomationEnabled(root)).toBe(true);
		await setHistoryAutomation(root, false);
		expect(await historyAutomationEnabled(root)).toBe(false);
	});
});

describe("#given completed history #when a digest is requested #then one segment is summarized", () => {
	it("does not call the generator unless enabled and selects newest completed evidence", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		writeSegment(root, segmentId);
		const newer = "2026-10-29T04-20-00Z";
		writeSegment(root, newer, "2026-10-29T04:30:00Z");
		let calls = 0;
		const generate = async (prompt: string): Promise<string> => {
			calls += 1;
			expect(prompt).toContain(newer);
			return JSON.stringify({ title: "Finder task", summary: "A short summary.", suggestion: null });
		};
		expect(await digestLatestHistory(root, generate, Date.parse("2026-10-30T00:00:00Z"))).toEqual({
			state: "disabled",
		});
		expect(calls).toBe(0);
		await setHistoryAutomation(root, true);
		const created = await digestLatestHistory(root, generate, Date.parse("2026-10-30T00:00:00Z"));
		expect(created.state).toBe("created");
		expect(created.digest).toMatchObject({ id: newer, sourceIds: [newer], title: "Finder task" });
		expect(calls).toBe(1);
		expect(await digestLatestHistory(root, generate, Date.parse("2026-10-30T00:00:00Z"))).toEqual({
			state: "up_to_date",
		});
		expect(calls).toBe(1);
	});

	it("returns empty for missing roots and ignores unfinished segments", async () => {
		const root = tempRoot();
		expect(await digestLatestHistory(join(root, "missing"))).toEqual({ state: "disabled" });
		mkdirSync(join(root, "segments"));
		writeSegment(root, segmentId, "2026-10-31T04:10:00Z");
		await setHistoryAutomation(root, true);
		expect(await digestLatestHistory(root, async () => "{}", Date.parse("2026-10-30T00:00:00Z"))).toEqual({
			state: "empty",
		});
	});
});

describe("#given generated model output #when validated #then malformed families are rejected", () => {
	it("counts every deterministic family as executed and rejects invalid output", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		writeSegment(root);
		await setHistoryAutomation(root, true);
		const valid = { title: "Okay", summary: "Done", suggestion: null };
		const cases: readonly { readonly output: string; readonly accepted: boolean }[] = [
			{ output: JSON.stringify(valid), accepted: true },
			{ output: JSON.stringify({ ...valid, title: "t".repeat(161) }), accepted: false },
			{ output: JSON.stringify({ ...valid, summary: "s".repeat(12_001) }), accepted: false },
			{
				output: JSON.stringify({ ...valid, suggestion: { name: "Bad Name", description: "d", goal: "g" } }),
				accepted: false,
			},
			{
				output: JSON.stringify({
					...valid,
					suggestion: { name: "good-name", description: "d".repeat(1025), goal: "g" },
				}),
				accepted: false,
			},
			{ output: JSON.stringify({ ...valid, extra: true }), accepted: false },
			{ output: "{", accepted: false },
		];
		let attempted = 0;
		let executed = 0;
		const discarded = 0;
		let rejections = 0;
		for (const [index, testCase] of cases.entries()) {
			attempted += 1;
			executed += 1;
			const caseRoot = index === 0 ? root : tempRoot();
			if (index > 0) {
				mkdirSync(join(caseRoot, "segments"));
				writeSegment(caseRoot);
				await setHistoryAutomation(caseRoot, true);
			}
			const result = digestLatestHistory(caseRoot, async () => testCase.output, Date.parse("2026-10-30T00:00:00Z"));
			if (testCase.accepted) {
				await expect(result).resolves.toMatchObject({ state: "created" });
			} else {
				await expect(result).rejects.toThrow();
				rejections += 1;
			}
		}
		expect({ attempted, executed, discarded, rejections }).toEqual({
			attempted: 7,
			executed: 7,
			discarded: 0,
			rejections: 6,
		});
	});

	it("rejects symlink digest files and malformed persisted JSON", async () => {
		const root = tempRoot();
		const summaries = join(root, "summaries");
		mkdirSync(summaries);
		const outside = join(root, "outside");
		writeFileSync(outside, "{}");
		symlinkSync(outside, join(summaries, `auto-${segmentId}.json`));
		await expect(listHistoryDigests(root)).rejects.toThrow("Invalid or oversized history digest file");
	});
});
