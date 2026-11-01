import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPaths, writeHistoryState } from "@apple-cua/core";
import { createHistorySource } from "./history-source.js";

const dirs: string[] = [];

function tempStateDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cua-history-source-"));
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
