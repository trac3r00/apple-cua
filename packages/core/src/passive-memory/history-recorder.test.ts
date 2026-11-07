import { describe, expect, it } from "bun:test";

import { appStateToHistory } from "./history-observation.js";
import { HistoryRecorder } from "./history-recorder.js";
import { DEFAULT_HISTORY_OBSERVATION_SETTINGS } from "./history-settings.js";
import { type HistoryFs, HistorySegmentStore } from "./history-store.js";

const BASE = Date.parse("2026-10-29T04:03:00Z");

function memoryFs(): HistoryFs & { files: Map<string, string> } {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	return {
		files,
		async ensureDir(path) {
			dirs.add(path);
		},
		async appendLine(path, line) {
			files.set(path, `${files.get(path) ?? ""}${line}\n`);
		},
		async writeText(path, text) {
			files.set(path, text);
		},
		async listDir() {
			return [];
		},
		async removeDir(path) {
			dirs.delete(path);
		},
	};
}

function makeRecorder() {
	const fs = memoryFs();
	const store = new HistorySegmentStore("/root", fs, () => BASE);
	const recorder = new HistoryRecorder({ store, now: () => BASE });
	return { fs, recorder };
}

describe("#given a stopped recorder #when recording #then nothing is captured", () => {
	it("defaults to stopped and refuses to record", async () => {
		const { fs, recorder } = makeRecorder();
		const { context, event } = appStateToHistory({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1,
			timestamp: "2026-10-29T04:03:00Z",
		});

		expect(recorder.status().state).toBe("stopped");
		expect(await recorder.record(context, event)).toBe("not_recording");
		expect(fs.files.size).toBe(0);
	});
});

describe("#given a started recorder #when recording an allowed app #then it writes a session and the event", () => {
	it("emits session.started on start and then records", async () => {
		const { fs, recorder } = makeRecorder();
		await recorder.start();
		const { context, event } = appStateToHistory({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1,
			windowId: 42,
			windowTitle: "Downloads",
			timestamp: "2026-10-29T04:03:00Z",
		});

		expect(await recorder.record(context, event)).toBe("recorded");
		const events = fs.files.get("/root/segments/2026-10-29T04-00-00Z/events.jsonl") ?? "";
		const lines = events
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines[0].kind).toBe("session.started");
		expect(lines[1]).toMatchObject({ id: 2, kind: "window.changed", window: { windowID: 42, title: "Downloads" } });
	});
});

describe("#given an excluded app #when recording #then it is suppressed", () => {
	it("suppresses an app the settings exclude", async () => {
		const fs = memoryFs();
		const store = new HistorySegmentStore("/root", fs, () => BASE);
		const recorder = new HistoryRecorder({
			store,
			now: () => BASE,
			settings: {
				...DEFAULT_HISTORY_OBSERVATION_SETTINGS,
				rules: [{ scope: "app", bundleID: "com.apple.finder", behavior: "do_not_observe" }],
			},
		});
		await recorder.start();
		const { context, event } = appStateToHistory({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1,
			timestamp: "2026-10-29T04:03:00Z",
		});

		expect(await recorder.record(context, event)).toBe("suppressed");
	});
});

describe("#given a paused recorder #when resumed #then recording works again", () => {
	it("stops recording while paused and resumes on resume", async () => {
		const { recorder } = makeRecorder();
		await recorder.start();
		recorder.pause();
		const { context, event } = appStateToHistory({
			app: "Finder",
			bundleId: "com.apple.finder",
			pid: 1,
			timestamp: "2026-10-29T04:03:00Z",
		});

		expect(await recorder.record(context, event)).toBe("not_recording");
		await recorder.resume();
		expect(recorder.status().state).toBe("running");
		expect(await recorder.record(context, event)).toBe("recorded");
	});
});
