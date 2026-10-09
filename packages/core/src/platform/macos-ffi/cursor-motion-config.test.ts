import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_STYLES, cursorMotionFromEnvironment, parseCursorMotion } from "./cursor-motion-config.js";

describe("parseCursorMotion", () => {
	it.each(CURSOR_MOTION_STYLES)("#given style %s #when parsed #then returns only that style", (style) => {
		expect(parseCursorMotion(style)).toEqual({ style });
		expect(parseCursorMotion({ style })).toEqual({ style });
	});

	it("#given all six styles #when listed #then they are distinct and exact", () => {
		expect([...CURSOR_MOTION_STYLES]).toEqual([
			"signature_arc",
			"spring_settle",
			"magnetic",
			"comet_swoop",
			"adaptive",
			"classic",
		]);
		expect(new Set(CURSOR_MOTION_STYLES).size).toBe(6);
	});

	it.each([undefined, null, "off"])("#given disabled value %s #when parsed #then returns undefined", (value) => {
		expect(parseCursorMotion(value)).toBeUndefined();
	});

	it("#given a full object #when parsed #then keeps every field", () => {
		const full = {
			style: "spring_settle",
			timing: "fitts",
			glideDurationMs: 800,
			startHandle: 0.2,
			endHandle: 0.4,
			arcSize: 0.5,
			arcFlow: -0.5,
			spring: 0.7,
			turnRadius: 50,
		};
		expect(parseCursorMotion(full)).toEqual(full);
	});

	it("#given omitted fields #when parsed #then none are defaulted", () => {
		const parsed = parseCursorMotion({ style: "magnetic", timing: "fixed" });
		expect(parsed).toEqual({ style: "magnetic", timing: "fixed" });
		expect(Object.keys(parsed ?? {})).toEqual(["style", "timing"]);
	});

	it.each([
		["glideDurationMs", 0, 5000],
		["startHandle", 0, 1],
		["endHandle", 0, 1],
		["arcSize", 0, 1],
		["arcFlow", -1, 1],
		["spring", 0.3, 1],
		["turnRadius", 1, 1000],
	] as const)("#given %s bounds #when at edges and beyond #then edges pass and outside fails", (key, min, max) => {
		expect(parseCursorMotion({ style: "classic", [key]: min })).toEqual({ style: "classic", [key]: min });
		expect(parseCursorMotion({ style: "classic", [key]: max })).toEqual({ style: "classic", [key]: max });
		const step = min === 0 && max === 5000 ? 1 : 0.01;
		expect(() => parseCursorMotion({ style: "classic", [key]: min - step })).toThrow(`${key}`);
		expect(() => parseCursorMotion({ style: "classic", [key]: max + step })).toThrow("out of range");
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"#given nonfinite %s #when parsed #then throws",
		(bad) => {
			expect(() => parseCursorMotion({ style: "adaptive", arcSize: bad })).toThrow("finite number");
		},
	);

	it("#given malformed values #when parsed #then each is rejected with a clear message", () => {
		expect(() => parseCursorMotion("zoom")).toThrow("unknown style");
		expect(() => parseCursorMotion({})).toThrow('"style" is required');
		expect(() => parseCursorMotion({ style: "off" })).toThrow("unknown style");
		expect(() => parseCursorMotion({ style: "classic", timing: "slow" })).toThrow("timing");
		expect(() => parseCursorMotion({ style: "classic", spring: "0.5" })).toThrow("finite number");
		expect(() => parseCursorMotion(5)).toThrow("expected a style name");
		expect(() => parseCursorMotion(["classic"])).toThrow("array");
	});

	it("#given an unknown key #when parsed #then throws naming it and the source", () => {
		expect(() => parseCursorMotion({ style: "classic", bogus: 1 }, "settings.cursorMotion")).toThrow(
			'settings.cursorMotion: unknown field "bogus"',
		);
	});
});

describe("cursorMotionFromEnvironment", () => {
	const key = "APPLE_CUA_CURSOR_MOTION";

	it.each([{}, { [key]: undefined }, { [key]: "" }, { [key]: "  " }, { [key]: "off" }])(
		"#given disabled environment %j #when read #then returns undefined",
		(environment) => {
			expect(cursorMotionFromEnvironment(environment)).toBeUndefined();
		},
	);

	it("#given a style name #when read #then returns it", () => {
		expect(cursorMotionFromEnvironment({ [key]: "comet_swoop" })).toEqual({ style: "comet_swoop" });
	});

	it("#given a JSON object #when read #then returns parsed config", () => {
		expect(cursorMotionFromEnvironment({ [key]: '{"style":"signature_arc","arcFlow":0.25}' })).toEqual({
			style: "signature_arc",
			arcFlow: 0.25,
		});
	});

	it("#given malformed JSON #when read #then the error names the variable", () => {
		expect(() => cursorMotionFromEnvironment({ [key]: '{"style":' })).toThrow(`${key}: invalid JSON`);
	});

	it("#given invalid content #when read #then errors name the variable", () => {
		expect(() => cursorMotionFromEnvironment({ [key]: "zoom" })).toThrow(`${key}: unknown style`);
		expect(() => cursorMotionFromEnvironment({ [key]: '{"style":"classic","x":1}' })).toThrow(
			`${key}: unknown field "x"`,
		);
		expect(() => cursorMotionFromEnvironment({ [key]: '{"style":"classic","spring":2}' })).toThrow("out of range");
	});
});
