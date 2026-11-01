import { describe, expect, it } from "bun:test";
import { vi } from "@opencua/test-support";

import { HistoryCaptureLoop, type HistorySampler } from "./history-capture.js";
import type { HistoryObservationInput } from "./history-observation.js";
import { HistoryRecorder } from "./history-recorder.js";
import { type HistoryFs, HistorySegmentStore } from "./history-store.js";

const BASE = Date.parse("2026-10-29T04:03:00Z");

function memoryFs(): HistoryFs & { files: Map<string, string> } {
	const files = new Map<string, string>();
	return {
		files,
		async ensureDir() {},
		async appendLine(path, line) {
			files.set(path, `${files.get(path) ?? ""}${line}\n`);
		},
		async writeText(path, text) {
			files.set(path, text);
		},
		async listDir() {
			return [];
		},
		async removeDir() {},
	};
}

function eventLines(files: Map<string, string>): Array<Record<string, unknown>> {
	const key = [...files.keys()].find((name) => name.endsWith("events.jsonl"));
	return (files.get(key ?? "") ?? "")
		.trim()
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line));
}

async function makeLoop(samples: Array<HistoryObservationInput | undefined>) {
	const fs = memoryFs();
	const store = new HistorySegmentStore("/root", fs, () => BASE);
	const recorder = new HistoryRecorder({ store, now: () => BASE });
	await recorder.start();
	const queue = [...samples];
	const sampler: HistorySampler = { sample: async () => queue.shift() };
	const loop = new HistoryCaptureLoop(recorder, sampler, { timer: () => () => {} });
	return { fs, loop };
}

const finder: HistoryObservationInput = {
	app: "Finder",
	bundleId: "com.apple.finder",
	pid: 1,
	windowId: 1,
	windowTitle: "Downloads",
	timestamp: "2026-10-29T04:03:00Z",
};

describe("#given the focused window is unchanged #when the loop ticks twice #then it records once", () => {
	it("dedupes identical focus between ticks", async () => {
		const { fs, loop } = await makeLoop([finder, { ...finder }]);
		await loop.tick();
		await loop.tick();

		const windowChanges = eventLines(fs.files).filter((event) => event["kind"] === "window.changed");
		expect(windowChanges).toHaveLength(1);
	});
});

describe("#given the focused window changes #when the loop ticks #then each distinct focus records", () => {
	it("records a new window.changed when the title changes", async () => {
		const { fs, loop } = await makeLoop([finder, { ...finder, windowTitle: "Documents" }]);
		await loop.tick();
		await loop.tick();

		expect(eventLines(fs.files).filter((event) => event["kind"] === "window.changed")).toHaveLength(2);
	});
});

describe("#given no focused window #when the loop ticks #then nothing is recorded", () => {
	it("skips an undefined sample", async () => {
		const { fs, loop } = await makeLoop([undefined]);
		await loop.tick();

		expect(eventLines(fs.files).filter((event) => event["kind"] === "window.changed")).toHaveLength(0);
	});
});

describe("#given a sampler that throws #when the loop ticks on its timer #then the error is reported not thrown", () => {
	it("routes tick errors to onError", async () => {
		const fs = memoryFs();
		const store = new HistorySegmentStore("/root", fs, () => BASE);
		const recorder = new HistoryRecorder({ store, now: () => BASE });
		await recorder.start();
		const onError = vi.fn();
		let fire: () => void = () => {};
		const loop = new HistoryCaptureLoop(
			recorder,
			{ sample: async () => Promise.reject(new Error("probe failed")) },
			{
				onError,
				timer: (callback) => {
					fire = callback;
					return () => {};
				},
			},
		);

		loop.start();
		fire();
		await new Promise((resolve) => setImmediate(resolve));
		expect(onError).toHaveBeenCalledOnce();
	});
});
