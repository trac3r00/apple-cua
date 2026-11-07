import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { surfaceAudioStatePath } from "./owned-surfaces.js";
import { listenToSurface } from "./surface-listen.js";

let stateDir: string;
const measured: { pid: number; durationMs: number }[] = [];
const dependencies = {
	owned: (pid: number, options: { readonly stateDir?: string }) => pid === 4242 && options.stateDir === stateDir,
	measure: (pid: number, durationMs: number) => {
		measured.push({ pid, durationMs });
		return { rms: 0.001, peak: 0.01, samples: 96_000 };
	},
};

beforeEach(() => {
	stateDir = realpathSync(mkdtempSync(join(tmpdir(), "opencua-surface-listen-")));
	measured.length = 0;
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
});

const report = (state: Record<string, unknown>) =>
	writeFileSync(surfaceAudioStatePath(4242, { stateDir }), JSON.stringify(state));

describe("#given an owned surface that reported its audio process #when an agent listens #then that process is tapped", () => {
	it("#given a reported GPU process #when listening for a second #then it taps that pid and answers in dB", () => {
		report({ playing: true, changedAt: 1, gpuPid: 777 });
		const heard = listenToSurface(4242, 1_000, { stateDir }, dependencies);
		expect(measured).toEqual([{ pid: 777, durationMs: 1_000 }]);
		expect(heard.rmsDb).toBeCloseTo(-60, 6);
		expect(heard.peakDb).toBeCloseTo(-40, 6);
		expect(heard.samples).toBe(96_000);
	});
});

describe("#given something that cannot be listened to #when an agent listens #then nothing is tapped", () => {
	it("#given a pid that is not an owned surface #when listening #then it is refused", () => {
		report({ playing: true, changedAt: 1, gpuPid: 777 });
		expect(() => listenToSurface(1, 1_000, { stateDir }, dependencies)).toThrow(/not an open owned surface/);
		expect(measured).toEqual([]);
	});

	it("#given a surface that has not reported its audio process #when listening #then it is refused", () => {
		report({ playing: false, changedAt: 1 });
		expect(() => listenToSurface(4242, 1_000, { stateDir }, dependencies)).toThrow(
			/has not reported an audio process/,
		);
		expect(measured).toEqual([]);
	});

	it("#given a duration outside 50..10000 ms #when listening #then it is refused", () => {
		report({ playing: true, changedAt: 1, gpuPid: 777 });
		for (const duration of [49, 10_001, 1.5]) {
			expect(() => listenToSurface(4242, duration, { stateDir }, dependencies)).toThrow(/duration_ms/);
		}
		expect(measured).toEqual([]);
	});
});
