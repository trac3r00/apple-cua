import { afterAll, describe, expect, it } from "vitest";
import { MacOSCuaHelper, MacOSCuaHelperError, resolveHelperBinaryPath } from "./macos-helper.js";

const helperPath = resolveHelperBinaryPath();
const helperAvailable = MacOSCuaHelper.isAvailable(helperPath);
const helperSuite = helperAvailable ? describe : describe.skip;

helperSuite("#given a built cua-helper binary", () => {
	const helper = new MacOSCuaHelper({ binaryPath: helperPath });

	afterAll(() => {
		helper.close();
	});

	describe("#when ping is invoked", () => {
		it("#then resolves without error", async () => {
			await expect(helper.ping()).resolves.toBeUndefined();
		});
	});

	describe("#when cursor_position is queried", () => {
		it("#then returns rounded numeric x/y coordinates", async () => {
			const point = await helper.cursorPosition();

			expect(Number.isFinite(point.x)).toBe(true);
			expect(Number.isFinite(point.y)).toBe(true);
			expect(Number.isInteger(point.x)).toBe(true);
			expect(Number.isInteger(point.y)).toBe(true);
		});
	});

	describe("#when keyPid sends a harmless f1 keystroke to our own pid", () => {
		it("#then resolves without error", async () => {
			await expect(helper.keyPid(process.pid, "f1")).resolves.toBeUndefined();
		});
	});

	describe("#when keyPid is invoked with pid 0", () => {
		it("#then rejects with MacOSCuaHelperError carrying a helper diagnostic", async () => {
			await expect(helper.keyPid(0, "f1")).rejects.toBeInstanceOf(MacOSCuaHelperError);
		});
	});
});

describe("#given resolveHelperBinaryPath", () => {
	describe("#when MACOS_CUA_HELPER_PATH env var is set", () => {
		it("#then prefers the override over the distributed path", () => {
			const previous = process.env.MACOS_CUA_HELPER_PATH;
			process.env.MACOS_CUA_HELPER_PATH = "/tmp/custom-cua-helper";

			try {
				expect(resolveHelperBinaryPath()).toBe("/tmp/custom-cua-helper");
			} finally {
				process.env.MACOS_CUA_HELPER_PATH = previous;
			}
		});
	});
});
