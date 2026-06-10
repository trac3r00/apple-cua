import { describe, expect, it, vi } from "vitest";

import { PassiveMemorySegmentWriter, type SegmentSink } from "./segment-writer.js";

function fakeSink(): SegmentSink & { writes: Array<{ path: string; bytes: Buffer }> } {
	const writes: Array<{ path: string; bytes: Buffer }> = [];
	return {
		writes,
		async write(path, bytes) {
			writes.push({ path, bytes });
		},
	};
}

describe("#given passive memory disabled #when capturing #then nothing is written or screenshotted", () => {
	it("never calls the screenshot fn or the sink when disabled", async () => {
		const sink = fakeSink();
		const screenshot = vi.fn();
		const writer = new PassiveMemorySegmentWriter({ enabled: false }, "/tmp/seg", sink, () => 1000);

		const result = await writer.capture({ bundleId: "com.apple.finder" }, screenshot);

		expect(result).toBeUndefined();
		expect(screenshot).not.toHaveBeenCalled();
		expect(sink.writes).toHaveLength(0);
	});
});

describe("#given passive memory enabled and allowed #when capturing #then it writes one segment", () => {
	it("writes the screenshot bytes to a timestamped path", async () => {
		const sink = fakeSink();
		const screenshot = vi.fn(async () => Buffer.from("png-bytes"));
		const writer = new PassiveMemorySegmentWriter({ enabled: true }, "/tmp/seg", sink, () => 1000);

		const result = await writer.capture({ bundleId: "com.apple.finder" }, screenshot);

		expect(screenshot).toHaveBeenCalledOnce();
		expect(sink.writes).toEqual([{ path: "/tmp/seg/segment-1000.png", bytes: Buffer.from("png-bytes") }]);
		expect(result).toBe("/tmp/seg/segment-1000.png");
	});
});

describe("#given an excluded app #when capturing #then it is skipped", () => {
	it("does not capture an excluded bundle id", async () => {
		const sink = fakeSink();
		const screenshot = vi.fn();
		const writer = new PassiveMemorySegmentWriter(
			{ enabled: true, excludedBundleIds: ["com.apple.finder"] },
			"/tmp/seg",
			sink,
			() => 1000,
		);

		expect(await writer.capture({ bundleId: "com.apple.finder" }, screenshot)).toBeUndefined();
		expect(screenshot).not.toHaveBeenCalled();
	});
});
