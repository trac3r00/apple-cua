import { writeFileSync } from "node:fs";
import { type ComputerInterface, MacOSHostComputer } from "@apple-cua/core";
import { describe, expect, it } from "vitest";

import { describeBenchmarkEnvironment, measureToolDescriptors, summarize } from "./measure.js";

const BASELINE_LIVE = process.env["BASELINE_LIVE"] === "1";
const BASELINE_WRITE = process.env["BASELINE_WRITE"] === "1";
const SCREENSHOT_ITERATIONS = 100;
const CLICK_CAPTURE_ITERATIONS = 50;
const METRICS_PATH = ".sisyphus/evidence/baseline-metrics.json";

describe("#given benchmark harness #when run without BASELINE_LIVE #then no timing claim is produced", () => {
	it("reports only descriptor sizes, which are real without touching the desktop", () => {
		const descriptors = measureToolDescriptors();

		expect(descriptors.bytes).toBeGreaterThan(0);
		expect(descriptors.tokens).toBeGreaterThan(0);
	});
});

describe("#given a live Mac #when BASELINE_LIVE=1 #then latency percentiles are recorded with provenance", () => {
	it.skipIf(!BASELINE_LIVE)(
		"measures screenshot and click/capture cycles against the real driver",
		async () => {
			const computer: ComputerInterface = new MacOSHostComputer();
			const screenshotTimings: number[] = [];
			const clickCaptureTimings: number[] = [];

			for (let iteration = 0; iteration < SCREENSHOT_ITERATIONS; iteration += 1) {
				const start = performance.now();
				const result = await computer.screenshot();
				const end = performance.now();

				expect(result.mimeType).toBe("image/png");
				expect(result.data.byteLength).toBeGreaterThan(0);
				screenshotTimings.push(end - start);
			}

			for (let iteration = 0; iteration < CLICK_CAPTURE_ITERATIONS; iteration += 1) {
				const start = performance.now();
				await computer.click({ x: 100, y: 200 });
				const screenshot = await computer.screenshot();
				const end = performance.now();

				expect(screenshot.mimeType).toBe("image/png");
				expect(screenshot.data.byteLength).toBeGreaterThan(0);
				clickCaptureTimings.push(end - start);
			}

			const screenshot = summarize(screenshotTimings);
			const clickCapture = summarize(clickCaptureTimings);
			const descriptors = measureToolDescriptors();
			const metrics = {
				screenshot_p50_ms: screenshot.p50,
				screenshot_p95_ms: screenshot.p95,
				screenshot_p99_ms: screenshot.p99,
				click_capture_p50_ms: clickCapture.p50,
				click_capture_p95_ms: clickCapture.p95,
				click_capture_p99_ms: clickCapture.p99,
				tool_descriptor_bytes: descriptors.bytes,
				tool_descriptor_estimated_tokens: descriptors.tokens,
				mode: "live" as const,
				captured_at: new Date().toISOString(),
				env: {
					...describeBenchmarkEnvironment(),
					baselineLive: BASELINE_LIVE,
					screenshotIterations: SCREENSHOT_ITERATIONS,
					clickCaptureIterations: CLICK_CAPTURE_ITERATIONS,
				},
			};

			if (BASELINE_WRITE) {
				writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
			}

			process.stdout.write(`baseline-live ${JSON.stringify(metrics)}\n`);

			expect(screenshot.p50).toBeGreaterThan(0);
			expect(screenshot.p95).toBeGreaterThanOrEqual(screenshot.p50);
			expect(clickCapture.p50).toBeGreaterThan(0);
		},
		300_000,
	);
});
