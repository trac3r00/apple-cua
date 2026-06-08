import { writeFileSync } from "node:fs";
import { type ComputerInterface, MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it } from "vitest";

import { anthropicComputerToolSchema } from "../../src/anthropic-computer-use.js";
import { buildAllTools } from "../../src/tools/index.js";

const BASELINE_LIVE = process.env["BASELINE_LIVE"] === "1";
const BASELINE_WRITE = process.env["BASELINE_WRITE"] === "1";
const SCREENSHOT_ITERATIONS = BASELINE_LIVE ? 100 : 1;
const CLICK_CAPTURE_ITERATIONS = BASELINE_LIVE ? 50 : 10;
const METRICS_PATH = ".sisyphus/evidence/baseline-metrics.json";

function percentile(sortedMilliseconds: readonly number[], fraction: number): number {
	const index = Math.floor(sortedMilliseconds.length * fraction);
	return sortedMilliseconds[Math.max(0, Math.min(index, sortedMilliseconds.length - 1))] ?? 0;
}

function estimateTokens(byteLength: number): number {
	return Math.ceil(byteLength / 4);
}

describe("#given baseline benchmark suite #when all benchmarks run #then combined metrics are valid", () => {
	it("computes baseline metrics without mutating tracked evidence by default", async () => {
		const computer: ComputerInterface = BASELINE_LIVE ? new MacOSHostComputer() : createBenchmarkComputer();
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

		screenshotTimings.sort((a, b) => a - b);
		clickCaptureTimings.sort((a, b) => a - b);

		const tools = buildAllTools({ computer: createBenchmarkComputer() });
		let totalBytes = 0;
		for (const tool of tools) {
			const schemaJson = JSON.stringify(tool.parameters);
			totalBytes += Buffer.byteLength(schemaJson, "utf8");
		}
		const nativeSchemaJson = JSON.stringify(anthropicComputerToolSchema);
		totalBytes += Buffer.byteLength(nativeSchemaJson, "utf8");

		const metrics = {
			screenshot_p50_ms: percentile(screenshotTimings, 0.5),
			screenshot_p95_ms: percentile(screenshotTimings, 0.95),
			screenshot_p99_ms: percentile(screenshotTimings, 0.99),
			click_capture_p50_ms: percentile(clickCaptureTimings, 0.5),
			click_capture_p95_ms: percentile(clickCaptureTimings, 0.95),
			click_capture_p99_ms: percentile(clickCaptureTimings, 0.99),
			tool_descriptor_bytes: totalBytes,
			tool_descriptor_estimated_tokens: estimateTokens(totalBytes),
			captured_at: new Date().toISOString(),
			env: {
				platform: process.platform,
				nodeVersion: process.version,
				baselineLive: BASELINE_LIVE,
				screenshotIterations: SCREENSHOT_ITERATIONS,
				clickCaptureIterations: CLICK_CAPTURE_ITERATIONS,
			},
		};

		if (BASELINE_WRITE) {
			writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
		}

		expect(metrics.screenshot_p50_ms).toBeGreaterThan(0);
		expect(metrics.screenshot_p95_ms).toBeGreaterThanOrEqual(metrics.screenshot_p50_ms);
		expect(metrics.click_capture_p50_ms).toBeGreaterThan(0);
		expect(metrics.click_capture_p95_ms).toBeGreaterThanOrEqual(metrics.click_capture_p50_ms);
		expect(metrics.tool_descriptor_bytes).toBeGreaterThan(0);
		expect(metrics.tool_descriptor_estimated_tokens).toBeGreaterThan(0);
	}, 120_000);
});

function createBenchmarkComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: async () => ({ data: Buffer.from("png"), mimeType: "image/png" as const, width: 100, height: 80 }),
		setTarget: () => undefined,
		move: async () => undefined,
		click: async () => undefined,
		rightClick: async () => undefined,
		middleClick: async () => undefined,
		doubleClick: async () => undefined,
		type: async () => undefined,
		key: async () => undefined,
		scroll: async () => undefined,
		drag: async () => undefined,
		getCursorPosition: async () => ({ x: 0, y: 0 }),
		getScreenSize: async () => ({ width: 100, height: 80 }),
		getAppState: async () => ({
			app: "TestApp",
			bundleId: "com.test.app",
			pid: 1234,
			frontmost: true,
			axAvailable: true,
			elements: [],
			screenshotBase64: "",
			screenshotWidth: 100,
			screenshotHeight: 80,
		}),
		listApps: async () => [{ name: "TestApp", bundleId: "com.test.app", pid: 1234, isRunning: true }],
		setValue: async () => undefined,
		performAction: async () => undefined,
		close: async () => undefined,
	};
}
