/** The upstream planner surface consumed by apple-cua; see README.md for provenance. */
export interface MotionParams {
	readonly style?: "signature_arc" | "spring_settle" | "magnetic" | "comet_swoop" | "adaptive" | "classic";
	readonly timing?: "native" | "fitts" | "fixed";
	readonly startHandle?: number;
	readonly endHandle?: number;
	readonly arcSize?: number;
	readonly arcFlow?: number;
	readonly spring?: number;
	readonly glideDurationMs?: number;
	readonly turnRadius?: number;
}

export interface MotionPoint {
	readonly x: number;
	readonly y: number;
}

export interface MoveRequest {
	readonly from: MotionPoint;
	readonly to: MotionPoint;
	readonly fromHeading?: number;
	readonly endHeading?: number;
	readonly target?: readonly [number, number, number, number] | null;
	readonly seed?: string;
	readonly reducedMotion?: boolean;
}

export interface Sample extends MotionPoint {
	readonly t: number;
	readonly heading: number;
}

export interface Trajectory {
	readonly samples: readonly Sample[];
	readonly arrivalT: number;
	duration(): number;
	end(): Sample;
	sampleAt(time: number): Sample;
}

export function planMove(params: MotionParams, request: MoveRequest): Trajectory;
