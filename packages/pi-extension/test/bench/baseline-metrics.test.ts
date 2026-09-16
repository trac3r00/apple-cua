import { writeFileSync } from "node:fs";
import os from "node:os";
import { type ComputerInterface, MacOSHostComputer } from "@macos-cua/core";
import { describe, expect, it } from "vitest";

import { anthropicComputerToolSchema } from "../../src/anthropic-computer-use.js";
import { buildAllTools } from "../../src/tools/index.js";

const BASELINE_LIVE = process.env["BASELINE_LIVE"] === "1";
const BASELINE_WRITE = process.env["BASELINE_WRITE"] === "1";
const SCREENSHOT_ITERATIONS = 100;
const CLICK_CAPTURE_ITERATIONS = 50;
const METRICS_PATH = ".sisyphus/evidence/baseline-metrics.json";

function percentile(sortedMilliseconds: readonly number[], fraction: number): number {
	const index = Math.floor(sortedMilliseconds.length * fraction);
	return sortedMilliseconds[Math.max(0, Math.min(index, sortedMilliseconds.length - 1))] ?? 0;
}

function estimateTokens(byteLength: number): number {
	return Math.ceil(byteLength / 4);
}

function measureToolDescriptors(): { readonly bytes: number; readonly tokens: number } {
	const tools = buildAllTools({ computer: createHarnessComputer() });
	let totalBytes = 0;
	for (const tool of tools) {
		totalBytes += Buffer.byteLength(JSON.stringify(tool.parameters), "utf8");
	}
	totalBytes += Buffer.byteLength(JSON.stringify(anthropicComputerToolSchema), "utf8");
	return { bytes: totalBytes, tokens: estimateTokens(totalBytes) };
}

function describeEnvironment(): Record<string, string | number | boolean> {
	return {
		platform: process.platform,
		arch: os.arch(),
		osRelease: os.release(),
		cpu: os.cpus()[0]?.model ?? "unknown",
		nodeVersion: process.version,
		baselineLive: BASELINE_LIVE,
		screenshotIterations: SCREENSHOT_ITERATIONS,
		clickCaptureIterations: CLICK_CAPTURE_ITERATIONS,
	};
}

describe("#given benchmark harness #when run without BASELINE_LIVE #then no timing claim is produced", () => {
	it("reports only descriptor sizes, which are real without touching the desktop", () => {
		const descriptors = measureToolDescriptors();

		expect(descriptors.bytes).toBeGreaterThan(0);
		expect(descriptors.tokens).toBeGreaterThan(0);
		expect(BASELINE_LIVE).toBe(false);
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

			screenshotTimings.sort((a, b) => a - b);
			clickCaptureTimings.sort((a, b) => a - b);

			const descriptors = measureToolDescriptors();
			const metrics = {
				screenshot_p50_ms: percentile(screenshotTimings, 0.5),
				screenshot_p95_ms: percentile(screenshotTimings, 0.95),
				screenshot_p99_ms: percentile(screenshotTimings, 0.99),
				click_capture_p50_ms: percentile(clickCaptureTimings, 0.5),
				click_capture_p95_ms: percentile(clickCaptureTimings, 0.95),
				click_capture_p99_ms: percentile(clickCaptureTimings, 0.99),
				tool_descriptor_bytes: descriptors.bytes,
				tool_descriptor_estimated_tokens: descriptors.tokens,
				mode: "live" as const,
				captured_at: new Date().toISOString(),
				env: describeEnvironment(),
			};

			if (BASELINE_WRITE) {
				writeFileSync(METRICS_PATH, JSON.stringify(metrics, null, 2));
			}

			expect(metrics.screenshot_p50_ms).toBeGreaterThan(0);
			expect(metrics.screenshot_p95_ms).toBeGreaterThanOrEqual(metrics.screenshot_p50_ms);
			expect(metrics.click_capture_p50_ms).toBeGreaterThan(0);
			expect(metrics.click_capture_p95_ms).toBeGreaterThanOrEqual(metrics.click_capture_p50_ms);
		},
		300_000,
	);
});

function createHarnessComputer(): ComputerInterface {
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
			display: { width: 100, height: 80, scaleFactor: 1 },
		}),
		getScreenshotViewport: async () => undefined,
		listApps: async () => [{ name: "TestApp", bundleId: "com.test.app", pid: 1234, isRunning: true }],
		setValue: async () => undefined,
		selectText: async () => undefined,
		performAction: async () => undefined,
		pressAtPosition: async () => false,
		typeIntoFocused: async () => false,
		close: async () => undefined,
	};
}
