import { MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it } from "vitest";

const BASELINE_LIVE = process.env["BASELINE_LIVE"] === "1";
const ITERATION_COUNT = 100;

function percentile(sortedMilliseconds: readonly number[], fraction: number): number {
	const index = Math.floor(sortedMilliseconds.length * fraction);
	return sortedMilliseconds[Math.max(0, Math.min(index, sortedMilliseconds.length - 1))] ?? 0;
}

describe("#given live screenshot benchmark #when MacOSHostComputer.screenshot runs 100 times #then percentiles are recorded", () => {
	it("captures p50/p95/p99 latency", async () => {
		if (!BASELINE_LIVE) {
			return;
		}

		const computer = new MacOSHostComputer();
		const timings: number[] = [];

		for (let iteration = 0; iteration < ITERATION_COUNT; iteration += 1) {
			const start = performance.now();
			const result = await computer.screenshot();
			const end = performance.now();

			expect(result.mimeType).toBe("image/png");
			expect(result.data.byteLength).toBeGreaterThan(0);
			expect(result.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

			timings.push(end - start);
		}

		timings.sort((a, b) => a - b);

		const metrics = {
			screenshot_p50_ms: percentile(timings, 0.5),
			screenshot_p95_ms: percentile(timings, 0.95),
			screenshot_p99_ms: percentile(timings, 0.99),
			screenshot_samples: timings.length,
			screenshot_min_ms: timings[0] ?? 0,
			screenshot_max_ms: timings[timings.length - 1] ?? 0,
		};

		expect(metrics.screenshot_p50_ms).toBeGreaterThan(0);
		expect(metrics.screenshot_p95_ms).toBeGreaterThanOrEqual(metrics.screenshot_p50_ms);
		expect(metrics.screenshot_p99_ms).toBeGreaterThanOrEqual(metrics.screenshot_p95_ms);
	}, 120_000);
});
