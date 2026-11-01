import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPaths, writeHistoryState } from "@opencua/core";
import { createHistorySource } from "./history-source.js";

const dirs: string[] = [];

function tempStateDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cua-history-source-")));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("#given no watcher state #when status is read #then it reports stopped with the data paths", () => {
	it("defaults to stopped and reports the event-stream root", async () => {
		const stateDir = tempStateDir();
		const source = createHistorySource({ stateDir });
		const status = await source.status();
		expect(status.state).toBe("stopped");
		expect(status.eventStreamRootPath).toBe(join(stateDir, "cua-history"));
		expect(status.retentionHours).toBe(6);
		expect(status.currentSegmentId).toBeUndefined();
	});
});

describe("#given settings updated through the tool #when read back #then the document round-trips", () => {
	it("persists settings for the watcher to read", async () => {
		const source = createHistorySource({ stateDir: tempStateDir() });
		await source.updateSettings({
			defaultApplicationBehavior: "do_not_observe",
			defaultURLBehavior: "observe",
			observePrivateBrowsing: false,
			rules: [{ scope: "app", bundleID: "com.apple.Terminal", behavior: "observe" }],
		});
		const read = await source.getSettings();
		expect(read.defaultApplicationBehavior).toBe("do_not_observe");
		expect(read.rules).toHaveLength(1);
	});
});

describe("#given a running watcher #when pause then resume #then the state file flips and back", () => {
	it("pauses a running watcher and resumes a paused one", async () => {
		const stateDir = tempStateDir();
		const source = createHistorySource({ stateDir, now: () => Date.parse("2026-10-29T04:03:00Z") });
		writeHistoryState(historyPaths(stateDir), "running");

		await source.pause();
		expect((await source.status()).state).toBe("paused");
		await source.resume();
		const status = await source.status();
		expect(status.state).toBe("running");
		expect(status.currentSegmentId).toBe("2026-10-29T04-00-00Z");
	});
});

describe("#given recorded segments on disk #when skills are suggested and saved #then files are read and written safely", () => {
	it("detects a repeat across segment files, saves once, and refuses to overwrite", async () => {
		const stateDir = tempStateDir();
		const segments = join(historyPaths(stateDir).root, "segments");
		const line = (app: string, title: string) =>
			JSON.stringify({
				kind: "window.changed",
				timestamp: "2026-11-01T10:00:00Z",
				app: { name: app },
				window: { title },
			});
		const flow = [line("Safari", "Invoice"), line("Notes", "Ledger"), line("Mail", "Draft")];
		for (const id of ["2026-11-01T10-00-00Z", "2026-11-01T10-10-00Z"]) {
			mkdirSync(join(segments, id), { recursive: true });
			writeFileSync(join(segments, id, "events.jsonl"), `${[...flow, "{not json"].join("\n")}\n`);
		}
		mkdirSync(join(segments, "not-a-segment"));
		const skillsDirectory = join(stateDir, "skills");
		const source = createHistorySource({ stateDir, skillsDirectory });
		const detection = await source.suggestSkills({ limit: 5 });
		expect(detection.scannedSegments).toBe(2);
		expect(detection.skippedEvents).toBe(2);
		expect(detection.candidates[0]?.occurrences).toBe(2);
		const draft = { name: "invoice-ledger", description: "Copy totals", body: "# Steps" };
		const path = await source.saveSkill(draft);
		expect(path).toBe(join(skillsDirectory, "invoice-ledger", "SKILL.md"));
		expect(readFileSync(path, "utf8")).toContain('name: "invoice-ledger"');
		await expect(source.saveSkill(draft)).rejects.toThrow("Skill already exists");
	});

	it("ignores a symlinked events file", async () => {
		const stateDir = tempStateDir();
		const segment = join(historyPaths(stateDir).root, "segments", "2026-11-01T10-00-00Z");
		mkdirSync(segment, { recursive: true });
		const outside = join(stateDir, "outside.jsonl");
		writeFileSync(outside, "{}\n");
		symlinkSync(outside, join(segment, "events.jsonl"));
		const detection = await createHistorySource({ stateDir }).suggestSkills({ limit: 5 });
		expect(detection.scannedSegments).toBe(0);
	});
});
