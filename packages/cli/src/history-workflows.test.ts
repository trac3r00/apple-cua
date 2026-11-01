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
import { HistorySegmentStore, nodeHistoryFs } from "@apple-cua/core";
import { historyDraftSchema, listHistoryTimeline, readHistoryEvidence, saveHistorySkill } from "./history-workflows.js";

const roots: string[] = [];

function tempRoot(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-history-workflows-")));
	roots.push(root);
	return root;
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
			suppressedEventCount: 0,
		}),
	);
	writeFileSync(join(directory, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function event(kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return { kind, timestamp: "2026-10-29T04:03:00Z", ...extra };
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("#given valid recorder segments #when listed #then newest entries include app names", () => {
	it("reads a real suppressed-only segment beside recorded activity without hiding missing nonempty evidence", async () => {
		const root = tempRoot();
		const store = new HistorySegmentStore(root, nodeHistoryFs, () => Date.parse("2026-10-29T04:03:00Z"));
		await store.recordSuppressed();
		writeSegment(root, "2026-10-29T04-10-00Z", [event("mouse.click", { app: { name: "Finder" } })]);

		expect(await listHistoryTimeline(root)).toMatchObject([
			{ id: "2026-10-29T04-10-00Z", eventCount: 1, apps: ["Finder"] },
			{ id: "2026-10-29T04-00-00Z", eventCount: 0, apps: [] },
		]);
		expect(await readHistoryEvidence(root, ["2026-10-29T04-00-00Z"])).toBe(
			"## 2026-10-29T04-00-00Z (2026-10-29T04:00:00Z to 2026-10-29T04:10:00Z)\n",
		);
	});

	it("lists events whose native records omit IDs", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		const older = "2026-10-29T04-00-00Z";
		const newer = "2026-10-29T04-10-00Z";
		writeSegment(root, newer, [event("window.changed", { app: { name: "Safari" } })]);
		writeSegment(root, older, [event("mouse.click", { app: { name: "Finder" } })]);

		const listed = await listHistoryTimeline(root);

		expect(listed.map(({ id, apps }) => ({ id, apps }))).toEqual([
			{ id: newer, apps: ["Safari"] },
			{ id: older, apps: ["Finder"] },
		]);
	});

	it("returns an empty timeline when the root or segments directory is absent", async () => {
		const root = tempRoot();
		expect(await listHistoryTimeline(join(root, "not-created"))).toEqual([]);
		mkdirSync(join(root, "history"));
		expect(await listHistoryTimeline(join(root, "history"))).toEqual([]);
	});

	it("lists a recording larger than the model budget without widening model sharing", async () => {
		const root = tempRoot();
		const id = "2026-10-29T04-00-00Z";
		const events = Array.from({ length: 1500 }, (_, index) =>
			event("keyboard.text_input", { id: index, app: { name: "TextEdit" }, keyboard: { text: "x" } }),
		);
		writeSegment(root, id, events);
		expect(Buffer.byteLength(readFileSync(join(root, "segments", id, "events.jsonl")))).toBeGreaterThan(120_000);
		expect(await listHistoryTimeline(root)).toMatchObject([{ id, eventCount: 1500, apps: ["TextEdit"] }]);
		await expect(readHistoryEvidence(root, [id])).rejects.toThrow("Selected history evidence exceeds 120000");
	});
});

describe("#given selected event records #when evidence is read #then text is redacted and context remains", () => {
	it("redacts typed and selected text plus accessibility text and values", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		const id = "2026-10-29T04-00-00Z";
		writeSegment(root, id, [
			event("keyboard.text_input", {
				app: { name: "Safari" },
				window: { title: "Account" },
				keyboard: { text: "typed-secret", target: { role: "text field", value: "field-secret" } },
			}),
			event("selection.changed", {
				selection: { text: "selected-secret", target: { role: "text", title: "Label", value: "value-secret" } },
				ax: { text: "ax-secret" },
			}),
			event("mouse.click", { mouse: { target: { role: "button", title: "Continue" } } }),
		]);

		const evidence = await readHistoryEvidence(root, [id]);

		expect(evidence).not.toContain("typed-secret");
		expect(evidence).not.toContain("selected-secret");
		expect(evidence).not.toContain("ax-secret");
		expect(evidence).not.toContain("field-secret");
		expect(evidence).not.toContain("value-secret");
		expect(evidence).toContain("[REDACTED]");
		expect(evidence).toContain('"kind":"keyboard.text_input"');
		expect(evidence).toContain('"kind":"selection.changed"');
		expect(evidence).toContain("Safari");
		expect(evidence).toContain("Account");
		expect(evidence).toContain("Continue");
	});
});

describe("#given an invalid draft #when parsed #then schema rejects boundary defects", () => {
	it("rejects a calibrated defective fixture and slug traversal variants", () => {
		const defective = { name: "../unsafe", description: "", body: "x".repeat(24_001) };
		expect(historyDraftSchema.safeParse(defective).success).toBe(false);
		const attempted = ["Upper", "has space", "../outside", "trailing-", "", "a".repeat(65)];
		let executed = 0;
		for (const name of attempted) {
			executed += 1;
			expect(historyDraftSchema.safeParse({ name, description: "valid", body: "body" }).success, name).toBe(false);
		}
		expect(executed).toBe(attempted.length);
	});

	it("accepts a generated finite slug alphabet and Unicode body", () => {
		const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-";
		const generate = () => {
			let seed = 0x5eed;
			const names: string[] = [];
			for (let length = 1; length <= 64; length += 1) {
				let name = "";
				for (let index = 0; index < length; index += 1) {
					seed = (seed * 16_807) % 2_147_483_647;
					const characterSet =
						length === 1 || index === 0 || index === length - 1 ? alphabet.slice(0, -1) : alphabet;
					name += characterSet[seed % characterSet.length];
				}
				names.push(name);
			}
			return names;
		};
		const names = generate();
		const replay = generate();
		let attempted = 0;
		let executed = 0;
		const failures: string[] = [];
		for (const name of names) {
			attempted += 1;
			executed += 1;
			const result = historyDraftSchema.safeParse({ name, description: "Résumé", body: "雪と café" });
			if (result.success) {
				expect(result.data.body).toBe("雪と café");
			} else {
				failures.push(name);
			}
		}
		expect(names).toEqual(replay);
		expect({ attempted, executed, discarded: 0, failures, replayed: replay.length }).toEqual({
			attempted: 64,
			executed: 64,
			discarded: 0,
			failures: [],
			replayed: 64,
		});
	});
});

describe("#given malformed or oversized evidence #when read #then it fails explicitly", () => {
	it("rejects malformed JSON, truncated JSON, invalid IDs, and too many IDs", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		const malformed = "2026-10-29T04-00-00Z";
		writeSegment(root, malformed, []);
		writeFileSync(join(root, "segments", malformed, "events.jsonl"), '{"kind":');

		await expect(readHistoryEvidence(root, [malformed])).rejects.toThrow("Malformed history evidence");
		await expect(readHistoryEvidence(root, ["../escape"])).rejects.toThrow("IDs");
		await expect(
			readHistoryEvidence(
				root,
				Array.from({ length: 13 }, () => malformed),
			),
		).rejects.toThrow("no more than 12");
	});

	it("reports a missing event file instead of treating a malformed segment as empty", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		const id = "2026-10-29T04-00-00Z";
		const directory = join(root, "segments", id);
		mkdirSync(directory);
		writeFileSync(
			join(directory, "metadata.json"),
			JSON.stringify({ id, startedAt: "2026-10-29T04:00:00Z", endedAt: "2026-10-29T04:10:00Z", eventCount: 1 }),
		);
		await expect(listHistoryTimeline(root)).rejects.toThrow();
	});

	it("caps aggregate redacted UTF-8 output across selected segments", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		const ids = [
			"2026-10-29T04-00-00Z",
			"2026-10-29T04-10-00Z",
			"2026-10-29T04-20-00Z",
			"2026-10-29T04-30-00Z",
			"2026-10-29T04-40-00Z",
			"2026-10-29T04-50-00Z",
		];
		for (const id of ids) {
			writeSegment(root, id, [event("window.changed", { title: "雪".repeat(7_000) })]);
		}

		await expect(readHistoryEvidence(root, ids)).rejects.toThrow(/120000/);
	});

	it("rejects duplicate IDs and malformed metadata timestamps", async () => {
		const root = tempRoot();
		mkdirSync(join(root, "segments"));
		const id = "2026-10-29T04-00-00Z";
		writeSegment(root, id, []);

		await expect(readHistoryEvidence(root, [id, id])).rejects.toThrow("unique");
		writeFileSync(
			join(root, "segments", id, "metadata.json"),
			JSON.stringify({ id, startedAt: "not-a-date", endedAt: "2026-10-29T04:10:00Z", eventCount: 0 }),
		);
		await expect(listHistoryTimeline(root)).rejects.toThrow("Invalid history metadata");
	});
});

describe("#given unsafe segment paths #when inspected #then symlinks are rejected", () => {
	it("rejects symlinked segment directories and evidence files", async () => {
		const root = tempRoot();
		const other = tempRoot();
		mkdirSync(join(root, "segments"));
		const id = "2026-10-29T04-00-00Z";
		const outside = join(other, "segment");
		mkdirSync(outside);
		writeFileSync(
			join(outside, "metadata.json"),
			JSON.stringify({ id, startedAt: "2026-10-29T04:00:00Z", endedAt: "2026-10-29T04:10:00Z", eventCount: 0 }),
		);
		writeFileSync(join(outside, "events.jsonl"), "");
		symlinkSync(outside, join(root, "segments", id));
		await expect(listHistoryTimeline(root)).rejects.toThrow("real directory");

		rmSync(join(root, "segments", id));
		mkdirSync(join(root, "segments", id));
		symlinkSync(join(outside, "metadata.json"), join(root, "segments", id, "metadata.json"));
		await expect(listHistoryTimeline(root)).rejects.toThrow("regular file");
		rmSync(join(root, "segments", id, "metadata.json"));
		writeFileSync(
			join(root, "segments", id, "metadata.json"),
			JSON.stringify({ id, startedAt: "2026-10-29T04:00:00Z", endedAt: "2026-10-29T04:10:00Z", eventCount: 0 }),
		);
		symlinkSync(join(outside, "events.jsonl"), join(root, "segments", id, "events.jsonl"));
		await expect(readHistoryEvidence(root, [id])).rejects.toThrow("regular file");
	});

	it("rejects symlinked skills root and preserves existing destination", async () => {
		const root = tempRoot();
		const skills = join(root, "skills");
		mkdirSync(skills);
		const draft = { name: "work-notes", description: "Notes", body: "Résumé and 雪." };
		const savedPath = await saveHistorySkill(skills, draft);
		const saved = readFileSync(savedPath, "utf8");
		expect(saved).toContain('name: "work-notes"');
		expect(saved).toContain('description: "Notes"');
		expect(saved).toContain("Résumé and 雪.");
		expect(lstatSync(join(skills, draft.name)).isDirectory()).toBe(true);
		await expect(saveHistorySkill(skills, draft)).rejects.toThrow("already exists");

		const missingSkills = join(root, "new-home", ".agents", "skills");
		const newPath = await saveHistorySkill(missingSkills, { ...draft, name: "first-use" });
		expect(newPath).toBe(join(missingSkills, "first-use", "SKILL.md"));
		expect(readFileSync(newPath, "utf8")).toContain("Résumé and 雪.");

		const outside = join(root, "outside");
		mkdirSync(outside);
		const link = join(root, "skills-link");
		symlinkSync(skills, link);
		await expect(saveHistorySkill(link, { ...draft, name: "other" })).rejects.toThrow("real directory");
		symlinkSync(outside, join(skills, "linked"));
		await expect(saveHistorySkill(skills, { ...draft, name: "linked" })).rejects.toThrow("already exists");
		expect(lstatSync(join(skills, "linked")).isSymbolicLink()).toBe(true);
	});
});
