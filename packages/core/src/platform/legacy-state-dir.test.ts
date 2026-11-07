import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputLock, homeStateDir } from "./input-lock.js";
import { cursorMotionFromEnvironment } from "./macos-ffi/cursor-motion-config.js";
import { StopSwitch, resolveStateDir } from "./stop-switch.js";

let home = "";
beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "opencua-legacy-state-")));
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("#given existing state directories #when defaults resolve #then existing legacy data remains in place", () => {
	it.each([
		{ current: false, legacy: false, expected: ".opencua" },
		{ current: false, legacy: true, expected: ".apple-cua" },
		{ current: true, legacy: true, expected: ".opencua" },
		{ current: true, legacy: false, expected: ".opencua" },
	])("selects $expected with current=$current legacy=$legacy", ({ current, legacy, expected }) => {
		if (current) mkdirSync(join(home, ".opencua"));
		if (legacy) mkdirSync(join(home, ".apple-cua"));
		expect(resolveStateDir({}, home)).toBe(join(home, expected));
		expect(homeStateDir(home)).toBe(join(home, expected));
		expect(new StopSwitch(resolveStateDir({}, home)).path).toBe(join(home, expected, "stop.json"));
		expect(new InputLock(resolveStateDir({}, home)).path).toBe(join(home, expected, "input-lock.json"));
	});

	it("honors explicit renamed and legacy state overrides without requiring their directories", () => {
		expect(resolveStateDir({ APPLE_CUA_STATE_DIR: "/legacy" })).toBe("/legacy");
		expect(resolveStateDir({ OPENCUA_STATE_DIR: "/new", APPLE_CUA_STATE_DIR: "/legacy" })).toBe("/new");
	});
});

describe("#given registrations written before the rename #when their env is read #then legacy names still apply", () => {
	it("reads APPLE_CUA_CURSOR_MOTION and prefers the renamed key", () => {
		expect(cursorMotionFromEnvironment({ APPLE_CUA_CURSOR_MOTION: "off" })).toBeUndefined();
		expect(cursorMotionFromEnvironment({ APPLE_CUA_CURSOR_MOTION: "magnetic" })?.style).toBe("magnetic");
		expect(
			cursorMotionFromEnvironment({ OPENCUA_CURSOR_MOTION: "adaptive", APPLE_CUA_CURSOR_MOTION: "magnetic" })?.style,
		).toBe("adaptive");
	});

	it("names the legacy key in its parse error", () => {
		expect(() => cursorMotionFromEnvironment({ APPLE_CUA_CURSOR_MOTION: "{bad" })).toThrow("APPLE_CUA_CURSOR_MOTION");
	});
});
