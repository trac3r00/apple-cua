import { afterEach, describe, expect, it } from "bun:test";
import { vi } from "@opencua/test-support";
import { applyLegacyEnv } from "./env-compat.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("#given legacy environment variables #when compatibility is applied #then renamed settings preserve precedence", () => {
	it("copies every suffix, including empty values, without changing the legacy keys", () => {
		const env: NodeJS.ProcessEnv = { APPLE_CUA_HOME: "/legacy", APPLE_CUA_CUSTOM_SETTING: "", OTHER: "untouched" };
		applyLegacyEnv(env);
		expect(env).toEqual({
			APPLE_CUA_HOME: "/legacy",
			APPLE_CUA_CUSTOM_SETTING: "",
			OPENCUA_HOME: "/legacy",
			OPENCUA_CUSTOM_SETTING: "",
			OTHER: "untouched",
		});
	});

	it.each(["/new", ""])("never overwrites an explicitly set renamed value %j", (value) => {
		const env = { APPLE_CUA_HOME: "/legacy", OPENCUA_HOME: value };
		applyLegacyEnv(env);
		expect(env.OPENCUA_HOME).toBe(value);
	});

	it("ignores undefined legacy values and similarly named prefixes", () => {
		const env = { APPLE_CUA_HOME: undefined, APPLE_CUA: "ignore", XAPPLE_CUA_HOME: "/other" };
		applyLegacyEnv(env);
		expect(Object.keys(env)).toEqual(["APPLE_CUA_HOME", "APPLE_CUA", "XAPPLE_CUA_HOME"]);
	});

	it.each(["./platform/stop-switch.js", "./platform/isolated.js"])(
		"applies compatibility before consumers of the %s entrypoint read configuration",
		async (entry) => {
			vi.stubEnv("APPLE_CUA_COMPAT_PROBE", "legacy");
			vi.stubEnv("OPENCUA_COMPAT_PROBE", undefined);
			vi.resetModules();
			await import(entry);
			expect(process.env["OPENCUA_COMPAT_PROBE"]).toBe("legacy");
		},
	);
});
