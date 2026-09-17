import { writeFileSync } from "node:fs";
import { MacOSHostComputer } from "@apple-cua/core";
import { describe, expect, it } from "vitest";

import { describeBenchmarkEnvironment, measureToolDescriptors, summarize } from "./measure.js";

const SCORECARD_LIVE = process.env["BASELINE_LIVE"] === "1";
const SCORECARD_WRITE = process.env["BASELINE_WRITE"] === "1";
const SCORECARD_PATH = ".sisyphus/evidence/driver-scorecard.json";
const OBSERVATION_ITERATIONS = 7;
const CAPTURE_ITERATIONS = 7;
const CAPTURE_TARGET_SIZE = { width: 1280, height: 800 };

type TargetApp = { readonly name: string; readonly pid: number };

async function resolveTargetApp(computer: MacOSHostComputer): Promise<TargetApp | undefined> {
	const apps = await computer.listApps();
	const chosen = apps.find((app) => app.name === "Finder") ?? apps.find((app) => app.isRunning && app.pid > 0);
	return chosen === undefined ? undefined : { name: chosen.name, pid: chosen.pid };
}

async function timeIt(action: () => Promise<void>): Promise<number> {
	const start = performance.now();
	await action();
	return performance.now() - start;
}

describe("#given driver scorecard #when run without BASELINE_LIVE #then no driver claim is produced", () => {
	it("reports descriptor size only, which needs no desktop", () => {
		const descriptors = measureToolDescriptors();

		expect(descriptors.bytes).toBeGreaterThan(0);
	});
});

describe("#given a live Mac #when BASELINE_LIVE=1 #then the driver scorecard is measured with provenance", () => {
	it.skipIf(!SCORECARD_LIVE)(
		"records observation, settle, capture and payload dimensions",
		async () => {
			const computer = new MacOSHostComputer();
			const target = await resolveTargetApp(computer);
			expect(target).toBeDefined();
			const pid = target?.pid ?? 0;

			const withScreenshot: number[] = [];
			const withoutScreenshot: number[] = [];
			const withoutSettle: number[] = [];
			let elements = 0;
			let axJsonBytes = 0;
			let screenshotBase64Chars = 0;

			for (let iteration = 0; iteration < OBSERVATION_ITERATIONS; iteration += 1) {
				withScreenshot.push(
					await timeIt(async () => {
						const state = await computer.getAppState(pid);
						elements = state.elements.length;
						axJsonBytes = Buffer.byteLength(JSON.stringify(state.elements), "utf8");
						screenshotBase64Chars = state.screenshotBase64.length;
						expect(state.screenshotBase64.length).toBeGreaterThan(0);
					}),
				);
				withoutScreenshot.push(
					await timeIt(async () => {
						await computer.getAppState(pid, { includeScreenshot: false });
					}),
				);
				withoutSettle.push(
					await timeIt(async () => {
						await computer.getAppState(pid, { includeScreenshot: false, settleMs: 0 });
					}),
				);
			}

			const pngTimings: number[] = [];
			const jpegTimings: number[] = [];
			let pngBytes = 0;
			let jpegBytes = 0;
			for (let iteration = 0; iteration < CAPTURE_ITERATIONS; iteration += 1) {
				pngTimings.push(
					await timeIt(async () => {
						const shot = await computer.screenshot({ targetSize: CAPTURE_TARGET_SIZE, format: "png" });
						pngBytes = shot.data.byteLength;
						expect(shot.mimeType).toBe("image/png");
					}),
				);
				jpegTimings.push(
					await timeIt(async () => {
						const shot = await computer.screenshot({
							targetSize: CAPTURE_TARGET_SIZE,
							format: "jpeg",
							quality: 72,
						});
						jpegBytes = shot.data.byteLength;
						expect(shot.mimeType).toBe("image/jpeg");
					}),
				);
			}

			const observationFull = summarize(withScreenshot);
			const observationAxOnly = summarize(withoutScreenshot);
			const observationNoSettle = summarize(withoutSettle);
			const capturePng = summarize(pngTimings);
			const captureJpeg = summarize(jpegTimings);
			const descriptors = measureToolDescriptors();
			const settleCostMs = observationAxOnly.p50 - observationNoSettle.p50;

			const scorecard = {
				mode: "live" as const,
				captured_at: new Date().toISOString(),
				target: { app: target?.name, elements },
				env: describeBenchmarkEnvironment(),
				observation_full_ms: observationFull,
				observation_ax_only_ms: observationAxOnly,
				observation_without_settle_ms: observationNoSettle,
				settle_cost_ms: settleCostMs,
				capture_png_ms: capturePng,
				capture_jpeg_ms: captureJpeg,
				payload: {
					screenshot_base64_chars: screenshotBase64Chars,
					screenshot_bytes: Math.round((screenshotBase64Chars * 3) / 4),
					ax_json_bytes: axJsonBytes,
					tool_descriptor_bytes: descriptors.bytes,
					tool_descriptor_estimated_tokens: descriptors.tokens,
				},
				capture_bytes: { png: pngBytes, jpeg: jpegBytes },
			};

			if (SCORECARD_WRITE) {
				writeFileSync(SCORECARD_PATH, JSON.stringify(scorecard, null, 2));
			}
			process.stdout.write(`driver-scorecard ${JSON.stringify(scorecard)}\n`);

			expect(observationFull.p50).toBeGreaterThan(0);
			expect(observationFull.p95).toBeGreaterThanOrEqual(observationFull.p50);
			expect(observationAxOnly.p50).toBeGreaterThan(0);
			expect(capturePng.p50).toBeGreaterThan(0);
			expect(pngBytes).toBeGreaterThan(0);
			expect(jpegBytes).toBeGreaterThan(0);
			expect(jpegBytes).toBeLessThan(pngBytes);
		},
		300_000,
	);
});
