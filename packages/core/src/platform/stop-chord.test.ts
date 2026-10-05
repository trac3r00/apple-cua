import { describe, expect, it } from "vitest";
import { StopChordDetector, startStopChordDetector } from "./stop-chord.js";
import type { StopStatus } from "./stop-switch.js";

const CONTROL = 0x00040000;
const ALTERNATE = 0x00080000;
const COMMAND = 0x00100000;
const SHIFT = 0x00020000;
const CHORD = CONTROL | ALTERNATE | COMMAND;

function detectorFor(sequence: readonly number[]) {
	let index = 0;
	let fired = 0;
	const detector = new StopChordDetector({
		readFlags: () => sequence[Math.min(index++, sequence.length - 1)] ?? 0,
		onChord: () => {
			fired += 1;
		},
	});
	return {
		fired: () => fired,
		run: (samples: number) => {
			for (let sample = 0; sample < samples; sample += 1) {
				detector.sample();
			}
		},
	};
}

describe("StopChordDetector #given a sequence of flag readings", () => {
	it("#when the chord is held for fewer than 3 samples #then it does not fire", () => {
		const probe = detectorFor([CHORD, CHORD, 0, 0]);
		probe.run(4);
		expect(probe.fired()).toBe(0);
	});

	it("#when the chord is held for 3 samples #then it fires exactly once, however long it stays held", () => {
		const probe = detectorFor(Array.from({ length: 20 }, () => CHORD));
		probe.run(20);
		expect(probe.fired()).toBe(1);
	});

	it("#when the chord is released and pressed again #then it re-arms and fires again", () => {
		const probe = detectorFor([CHORD, CHORD, CHORD, 0, CHORD, CHORD, CHORD]);
		probe.run(7);
		expect(probe.fired()).toBe(2);
	});

	it("#when Shift is also held #then it never fires", () => {
		const probe = detectorFor(Array.from({ length: 10 }, () => CHORD | SHIFT));
		probe.run(10);
		expect(probe.fired()).toBe(0);
	});

	it("#when only two of the three modifiers are held #then it never fires", () => {
		const probe = detectorFor(Array.from({ length: 10 }, () => CONTROL | COMMAND));
		probe.run(10);
		expect(probe.fired()).toBe(0);
	});

	it("#when the held count is interrupted by a gap #then the debounce restarts", () => {
		const probe = detectorFor([CHORD, CHORD, 0, CHORD, CHORD, 0]);
		probe.run(6);
		expect(probe.fired()).toBe(0);
	});

	it("#when reading the flags throws #then the error is reported once and the detector keeps running", () => {
		const errors: unknown[] = [];
		let fired = 0;
		let reads = 0;
		const detector = new StopChordDetector({
			readFlags: () => {
				reads += 1;
				if (reads <= 2) {
					throw new Error("boom");
				}
				return CHORD;
			},
			onChord: () => {
				fired += 1;
			},
			onError: (error) => errors.push(error),
		});
		for (let sample = 0; sample < 5; sample += 1) {
			detector.sample();
		}
		expect(errors).toHaveLength(1);
		expect(fired).toBe(1);
	});
});

describe("StopChordDetector #given an injected timer", () => {
	it("#when started and stopped #then it samples on the timer and cancels it", () => {
		let tick: (() => void) | undefined;
		let intervalMs: number | undefined;
		let cancelled = false;
		let fired = 0;
		const detector = new StopChordDetector({
			readFlags: () => CHORD,
			onChord: () => {
				fired += 1;
			},
			timer: (callback, milliseconds) => {
				tick = callback;
				intervalMs = milliseconds;
				return () => {
					cancelled = true;
				};
			},
		});

		detector.start();
		for (let sample = 0; sample < 3; sample += 1) {
			tick?.();
		}
		detector.stop();

		expect(intervalMs).toBe(50);
		expect(fired).toBe(1);
		expect(cancelled).toBe(true);
	});
});

describe("startStopChordDetector #given a stop switch", () => {
	it("#when the chord fires twice #then the first stop's reason and time are kept", () => {
		const calls: string[] = [];
		let status: StopStatus = { stopped: false };
		let tick: (() => void) | undefined;
		const detector = startStopChordDetector(
			{
				status: () => status,
				stop: (reason, source) => {
					calls.push(`${source}:${reason}`);
					status = { stopped: true, stoppedAt: "t", reason, source };
					return { stopped: true, stoppedAt: "t", reason, source };
				},
			},
			() => CHORD,
			{
				timer: (callback) => {
					tick = callback;
					return () => undefined;
				},
			},
		);
		for (let sample = 0; sample < 3; sample += 1) {
			tick?.();
		}
		detector.stop();

		expect(calls).toEqual(["chord:keyboard chord Control+Option+Command"]);
	});
});
