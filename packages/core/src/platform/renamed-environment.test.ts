import { describe, expect, it } from "vitest";
import { renamedEnvironmentVariable } from "./renamed-environment.js";

describe("#given an environment that only holds the pre-rename name #when the renamed variable is read #then the legacy value is still honoured", () => {
	it("falls back to the name the variable shipped under before the rename", () => {
		expect(
			renamedEnvironmentVariable("APPLE_CUA_DELIVERY", "MACOS_CUA_DELIVERY", { MACOS_CUA_DELIVERY: "background" }),
		).toBe("background");
	});
});

describe("#given both names are set #when the renamed variable is read #then the current name wins", () => {
	it("prefers the primary variable over the legacy one", () => {
		expect(
			renamedEnvironmentVariable("APPLE_CUA_DELIVERY", "MACOS_CUA_DELIVERY", {
				APPLE_CUA_DELIVERY: "background",
				MACOS_CUA_DELIVERY: "attended",
			}),
		).toBe("background");
	});
});

describe("#given the primary name is set to an empty value #when the renamed variable is read #then the legacy name is used instead", () => {
	it("treats an empty primary value as unset rather than as an override", () => {
		expect(
			renamedEnvironmentVariable("APPLE_CUA_DELIVERY", "MACOS_CUA_DELIVERY", {
				APPLE_CUA_DELIVERY: "",
				MACOS_CUA_DELIVERY: "background",
			}),
		).toBe("background");
	});
});

describe("#given neither name is set #when the renamed variable is read #then the answer is undefined", () => {
	it("reports unset without inventing a value", () => {
		expect(renamedEnvironmentVariable("APPLE_CUA_DELIVERY", "MACOS_CUA_DELIVERY", {})).toBeUndefined();
	});
});
