import { describe, expect, it } from "vitest";
import { planMove } from "../../../vendor/cua-cursor-motion.js";
import { parseCursorMotion } from "./cursor-motion-config.js";
import { cursorMotionCommand } from "./cursor-motion.js";
import golden from "./fixtures/cursor-motion-golden.json";

describe("#given upstream Rust golden trajectories #when the vendored planner runs #then paths and timing agree", () => {
	it.each(golden.cases)("$name", ({ params, request, out }) => {
		const [x, y, width, height] = request.target;
		if (x === undefined || y === undefined || width === undefined || height === undefined) {
			throw new Error("Golden fixture must have a four-coordinate target");
		}
		const motion = parseCursorMotion(params);
		if (motion === undefined) {
			throw new Error("Golden fixture must enable motion");
		}
		const trajectory = planMove(motion, { ...request, target: [x, y, width, height] });
		expect(trajectory.samples).toHaveLength(out.samples);
		expect(trajectory.arrivalT).toBeCloseTo(out.arrival, 6);
		expect(trajectory.duration()).toBeCloseTo(out.duration, 6);
		for (const [index, expected] of out.grid.entries()) {
			const sample = trajectory.sampleAt((trajectory.duration() * index) / golden.grid);
			const actual = [sample.t, sample.x, sample.y, sample.heading];
			for (const [coordinate, value] of expected.entries()) {
				expect(actual[coordinate]).toBeCloseTo(value, 6);
			}
		}
	});
});

describe("#given the native cursor state #when planning its next move #then playback starts at the right hotspot", () => {
	it("starts an interrupted motion from the visible position, not the previous target", () => {
		const command = cursorMotionCommand(
			{ x: 700, y: 400 },
			{ x: 231, y: 142, shown: true, reducedMotion: false },
			{ style: "spring_settle" },
		);
		const payload: unknown = JSON.parse(command.slice("trajectory ".length));
		expect(payload).toMatchObject({
			style: "spring_settle",
			samples: expect.arrayContaining([[0, 231, 142, Math.PI / 4]]),
		});
	});

	it("places a newly shown cursor at its destination instead of flying from a stale location", () => {
		const command = cursorMotionCommand(
			{ x: 700, y: 400 },
			{ x: -500, y: 800, shown: false, reducedMotion: false },
			{ style: "signature_arc" },
		);
		const payload: unknown = JSON.parse(command.slice("trajectory ".length));
		expect(payload).toMatchObject({
			samples: expect.arrayContaining([[0, 700, 400, Math.PI / 4]]),
		});
	});

	it("uses the reduced-motion path returned by the operating system", () => {
		const command = cursorMotionCommand(
			{ x: 700, y: 100 },
			{ x: 100, y: 100, shown: true, reducedMotion: true },
			{ style: "comet_swoop", timing: "fixed", glideDurationMs: 2_000 },
		);
		const payload: unknown = JSON.parse(command.slice("trajectory ".length));
		if (
			typeof payload !== "object" ||
			payload === null ||
			!("samples" in payload) ||
			!Array.isArray(payload.samples)
		) {
			throw new Error("Expected native trajectory samples");
		}
		expect(payload.samples.length).toBeGreaterThan(1);
		for (const sample of payload.samples) {
			expect(sample).toEqual([expect.any(Number), expect.any(Number), 100, Math.PI / 4]);
		}
		expect(payload.samples.at(-1)).toEqual([0.12, 700, 100, Math.PI / 4]);
	});
});
