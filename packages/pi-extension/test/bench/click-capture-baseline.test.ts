import { describe, expect, it, vi } from "vitest";

import type { ComputerActionDriver } from "../../src/anthropic-computer-use.js";

const BASELINE_LIVE = process.env["BASELINE_LIVE"] === "1";
const ITERATION_COUNT = 50;

function createComputer(): ComputerActionDriver {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn<ComputerActionDriver["screenshot"]>().mockResolvedValue({
			data: Buffer.from("png"),
			mimeType: "image/png",
			width: 100,
			height: 80,
		}),
		setTarget: vi.fn<ComputerActionDriver["setTarget"]>(),
		move: vi.fn<ComputerActionDriver["move"]>().mockResolvedValue(undefined),
		click: vi.fn<ComputerActionDriver["click"]>().mockResolvedValue(undefined),
		rightClick: vi.fn<ComputerActionDriver["rightClick"]>().mockResolvedValue(undefined),
		middleClick: vi.fn<ComputerActionDriver["middleClick"]>().mockResolvedValue(undefined),
		doubleClick: vi.fn<ComputerActionDriver["doubleClick"]>().mockResolvedValue(undefined),
		type: vi.fn<ComputerActionDriver["type"]>().mockResolvedValue(undefined),
		key: vi.fn<ComputerActionDriver["key"]>().mockResolvedValue(undefined),
		scroll: vi.fn<ComputerActionDriver["scroll"]>().mockResolvedValue(undefined),
		drag: vi.fn<ComputerActionDriver["drag"]>().mockResolvedValue(undefined),
		getCursorPosition: vi.fn<ComputerActionDriver["getCursorPosition"]>().mockResolvedValue({ x: 7, y: 9 }),
		getScreenSize: vi.fn<ComputerActionDriver["getScreenSize"]>().mockResolvedValue({ width: 100, height: 80 }),
		getAppState: vi.fn<ComputerActionDriver["getAppState"]>().mockResolvedValue({
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
		listApps: vi.fn<ComputerActionDriver["listApps"]>().mockResolvedValue([]),
		setValue: vi.fn<ComputerActionDriver["setValue"]>().mockResolvedValue(undefined),
		performAction: vi.fn<ComputerActionDriver["performAction"]>().mockResolvedValue(undefined),
		close: vi.fn<ComputerActionDriver["close"]>().mockResolvedValue(undefined),
	};
}

function percentile(sortedMilliseconds: readonly number[], fraction: number): number {
	const index = Math.floor(sortedMilliseconds.length * fraction);
	return sortedMilliseconds[Math.max(0, Math.min(index, sortedMilliseconds.length - 1))] ?? 0;
}

describe("#given click + app-state cycle benchmark #when executed 50 times #then percentiles are recorded", () => {
	it("captures p50/p95 latency for click + explicit screenshot pipeline", async () => {
		const computer = createComputer();
		const timings: number[] = [];

		for (let iteration = 0; iteration < ITERATION_COUNT; iteration += 1) {
			const start = performance.now();
			await computer.click({ x: 100, y: 200 });
			const screenshot = await computer.screenshot({ targetSize: { width: 1280, height: 720 } });
			const end = performance.now();

			expect(screenshot.data.byteLength).toBeGreaterThan(0);

			timings.push(end - start);
		}

		timings.sort((a, b) => a - b);

		const metrics = {
			click_capture_p50_ms: percentile(timings, 0.5),
			click_capture_p95_ms: percentile(timings, 0.95),
			click_capture_p99_ms: percentile(timings, 0.99),
			click_capture_samples: timings.length,
			click_capture_min_ms: timings[0] ?? 0,
			click_capture_max_ms: timings[timings.length - 1] ?? 0,
		};

		expect(metrics.click_capture_p50_ms).toBeGreaterThan(0);
		expect(metrics.click_capture_p95_ms).toBeGreaterThanOrEqual(metrics.click_capture_p50_ms);
		expect(metrics.click_capture_p99_ms).toBeGreaterThanOrEqual(metrics.click_capture_p95_ms);
	});
});

describe("#given live click + screenshot benchmark #when executed with real MacOSHostComputer #then percentiles are recorded", () => {
	it("captures p50/p95 for real click + screenshot pipeline", async () => {
		if (!BASELINE_LIVE) {
			return;
		}

		const { MacOSHostComputer } = await import("@macos-cua/core");
		const computer = new MacOSHostComputer();
		const timings: number[] = [];

		for (let iteration = 0; iteration < ITERATION_COUNT; iteration += 1) {
			const start = performance.now();
			await computer.click({ x: 100, y: 200 });
			const screenshot = await computer.screenshot();
			const end = performance.now();

			expect(screenshot.mimeType).toBe("image/png");
			expect(screenshot.data.byteLength).toBeGreaterThan(0);

			timings.push(end - start);
		}

		timings.sort((a, b) => a - b);

		const metrics = {
			click_capture_live_p50_ms: percentile(timings, 0.5),
			click_capture_live_p95_ms: percentile(timings, 0.95),
			click_capture_live_p99_ms: percentile(timings, 0.99),
			click_capture_live_samples: timings.length,
			click_capture_live_min_ms: timings[0] ?? 0,
			click_capture_live_max_ms: timings[timings.length - 1] ?? 0,
		};

		expect(metrics.click_capture_live_p50_ms).toBeGreaterThan(0);
		expect(metrics.click_capture_live_p95_ms).toBeGreaterThanOrEqual(metrics.click_capture_live_p50_ms);
		expect(metrics.click_capture_live_p99_ms).toBeGreaterThanOrEqual(metrics.click_capture_live_p95_ms);
	}, 120_000);
});
