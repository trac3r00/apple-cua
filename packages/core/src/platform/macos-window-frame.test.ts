import { describe, expect, it } from "vitest";
import type { AXUIElementRef } from "./macos-ffi/accessibility.js";
import { type WindowFrameDependencies, framesApproximatelyEqual, setWindowFrame } from "./macos-window-frame.js";

const requested = { x: 10, y: 20, width: 800, height: 600 };

describe("setWindowFrame #given a top-level AX window #when geometry settles in stages #then only mismatched components are rewritten", () => {
	it("writes position before size and reports independent WindowServer geometry", async () => {
		const frames = [
			{ x: 0, y: 0, width: 400, height: 300 },
			{ x: 40, y: 50, width: 800, height: 600 },
			{ x: 11, y: 19, width: 801, height: 599 },
		];
		const fake = fakeDependencies(frames);

		const result = await setWindowFrame(42, 71, requested, fake.dependencies);

		expect(fake.writes).toEqual(["position:10,20", "size:800,600", "position:10,20"]);
		expect(result).toEqual({ requested, applied: frames[2], verified: true, attempts: 2 });
	});
});

describe("setWindowFrame #given a window that ignores accessibility writes #when verification expires #then mismatch is reported", () => {
	it("never reports the requested AX values as applied geometry", async () => {
		const observed = { x: 1, y: 2, width: 300, height: 200 };
		const fake = fakeDependencies([observed]);

		const result = await setWindowFrame(42, 71, requested, fake.dependencies);

		expect(result.verified).toBe(false);
		expect(result.applied).toEqual(observed);
		expect(result.applied).not.toEqual(requested);
		expect(fake.writes.length).toBeGreaterThan(2);
	});
});

describe("framesApproximatelyEqual #given WindowServer rounding #when comparing geometry #then two points are tolerated", () => {
	it("accepts the boundary and rejects larger drift", () => {
		expect(framesApproximatelyEqual(requested, { x: 12, y: 18, width: 798, height: 602 })).toBe(true);
		expect(framesApproximatelyEqual(requested, { ...requested, x: 12.1 })).toBe(false);
	});
});

function fakeDependencies(frames: readonly (typeof requested)[]): {
	readonly dependencies: WindowFrameDependencies;
	readonly writes: string[];
} {
	const element: AXUIElementRef = {};
	const writes: string[] = [];
	let readIndex = 0;
	let clock = 0;
	return {
		writes,
		dependencies: {
			findWindowElement: () => element,
			setPosition: (_element, x, y) => writes.push(`position:${x},${y}`),
			setSize: (_element, width, height) => writes.push(`size:${width},${height}`),
			release: () => undefined,
			windowFrames: async () => {
				const frame = frames[Math.min(readIndex, frames.length - 1)];
				readIndex += 1;
				return frame === undefined ? [] : [{ id: 71, pid: 42, frame }];
			},
			now: () => clock,
			delay: async (milliseconds) => {
				clock += milliseconds;
			},
		},
	};
}
