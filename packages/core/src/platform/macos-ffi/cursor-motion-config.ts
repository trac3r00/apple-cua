export const CURSOR_MOTION_STYLES = [
	"signature_arc",
	"spring_settle",
	"magnetic",
	"comet_swoop",
	"adaptive",
	"classic",
] as const;

export type CursorMotionStyle = (typeof CURSOR_MOTION_STYLES)[number];

const CURSOR_MOTION_TIMINGS = ["native", "fitts", "fixed"] as const;

export type CursorMotionTiming = (typeof CURSOR_MOTION_TIMINGS)[number];

export interface CursorMotionConfig {
	readonly style: CursorMotionStyle;
	readonly timing?: CursorMotionTiming;
	readonly glideDurationMs?: number;
	readonly startHandle?: number;
	readonly endHandle?: number;
	readonly arcSize?: number;
	readonly arcFlow?: number;
	readonly spring?: number;
	readonly turnRadius?: number;
}

export const CURSOR_MOTION_ENV = "APPLE_CUA_CURSOR_MOTION";

type NumericKey = Exclude<keyof CursorMotionConfig, "style" | "timing">;

const NUMERIC_BOUNDS: Readonly<Record<NumericKey, readonly [number, number]>> = {
	glideDurationMs: [0, 5000],
	startHandle: [0, 1],
	endHandle: [0, 1],
	arcSize: [0, 1],
	arcFlow: [-1, 1],
	spring: [0.3, 1],
	turnRadius: [1, 1000],
};

const NUMERIC_KEYS = [
	"glideDurationMs",
	"startHandle",
	"endHandle",
	"arcSize",
	"arcFlow",
	"spring",
	"turnRadius",
] as const satisfies readonly NumericKey[];
const ALLOWED_KEYS: readonly string[] = ["style", "timing", ...NUMERIC_KEYS];

function isStyle(value: unknown): value is CursorMotionStyle {
	return CURSOR_MOTION_STYLES.some((style) => style === value);
}

function isTiming(value: unknown): value is CursorMotionTiming {
	return CURSOR_MOTION_TIMINGS.some((timing) => timing === value);
}

function isNumericKey(key: string): key is NumericKey {
	return NUMERIC_KEYS.some((numericKey) => numericKey === key);
}

function styleError(value: unknown, source: string): Error {
	return new Error(
		`${source}: unknown style ${JSON.stringify(value)}; use one of ${CURSOR_MOTION_STYLES.join(", ")} or "off"`,
	);
}

export function parseCursorMotion(value: unknown, source = "cursor motion"): CursorMotionConfig | undefined {
	if (value === undefined || value === null || value === "off") return undefined;
	if (typeof value === "string") {
		if (!isStyle(value)) throw styleError(value, source);
		return { style: value };
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(
			`${source}: expected a style name, "off" or an object, got ${Array.isArray(value) ? "array" : typeof value}`,
		);
	}
	const record = new Map(Object.entries(value));
	for (const key of record.keys()) {
		if (!ALLOWED_KEYS.includes(key)) {
			throw new Error(`${source}: unknown field "${key}"; allowed fields are ${ALLOWED_KEYS.join(", ")}`);
		}
	}
	const style = record.get("style");
	if (style === undefined) throw new Error(`${source}: "style" is required`);
	if (!isStyle(style)) throw styleError(style, `${source}.style`);
	let config: CursorMotionConfig = { style };
	for (const [key, field] of record) {
		if (key === "style") continue;
		if (key === "timing") {
			if (!isTiming(field)) {
				throw new Error(
					`${source}.timing: expected one of ${CURSOR_MOTION_TIMINGS.join(", ")}, got ${JSON.stringify(field)}`,
				);
			}
			config = { ...config, timing: field };
			continue;
		}
		if (!isNumericKey(key)) continue;
		const [min, max] = NUMERIC_BOUNDS[key];
		if (typeof field !== "number" || !Number.isFinite(field)) {
			throw new Error(`${source}.${key}: expected a finite number, got ${JSON.stringify(field) ?? String(field)}`);
		}
		if (field < min || field > max) {
			throw new Error(`${source}.${key}: ${field} is out of range ${min}..${max}`);
		}
		config = { ...config, [key]: field };
	}
	return config;
}

export function cursorMotionFromEnvironment(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): CursorMotionConfig | undefined {
	const raw = environment[CURSOR_MOTION_ENV]?.trim();
	if (raw === undefined || raw === "") return undefined;
	if (raw.startsWith("{")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${CURSOR_MOTION_ENV}: invalid JSON (${reason}); use a style name, "off" or a JSON object`);
		}
		return parseCursorMotion(parsed, CURSOR_MOTION_ENV);
	}
	return parseCursorMotion(raw, CURSOR_MOTION_ENV);
}
