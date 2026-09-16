import os from "node:os";
import type { ComputerInterface } from "@macos-cua/core";

import { anthropicComputerToolSchema } from "../../src/anthropic-computer-use.js";
import { buildAllTools } from "../../src/tools/index.js";

export function percentile(sortedMilliseconds: readonly number[], fraction: number): number {
	const index = Math.floor(sortedMilliseconds.length * fraction);
	return sortedMilliseconds[Math.max(0, Math.min(index, sortedMilliseconds.length - 1))] ?? 0;
}

export function estimateTokens(byteLength: number): number {
	return Math.ceil(byteLength / 4);
}

export function measureToolDescriptors(): { readonly bytes: number; readonly tokens: number } {
	const tools = buildAllTools({ computer: createHarnessComputer() });
	let totalBytes = 0;
	for (const tool of tools) {
		totalBytes += Buffer.byteLength(JSON.stringify(tool.parameters), "utf8");
	}
	totalBytes += Buffer.byteLength(JSON.stringify(anthropicComputerToolSchema), "utf8");
	return { bytes: totalBytes, tokens: estimateTokens(totalBytes) };
}

export function describeBenchmarkEnvironment(): Record<string, string | number | boolean> {
	return {
		platform: process.platform,
		arch: os.arch(),
		osRelease: os.release(),
		cpu: os.cpus()[0]?.model ?? "unknown",
		nodeVersion: process.version,
	};
}

export function summarize(timings: readonly number[]): {
	readonly p50: number;
	readonly p95: number;
	readonly p99: number;
	readonly min: number;
	readonly max: number;
	readonly samples: number;
} {
	const sorted = [...timings].sort((a, b) => a - b);
	return {
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
		samples: sorted.length,
	};
}

export function createHarnessComputer(): ComputerInterface {
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
		assertObservationCurrent: () => undefined,
		close: async () => undefined,
	};
}
