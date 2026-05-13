import { describe, expect, it } from "vitest";
import { MacOSHostComputer } from "./index.js";

describe("#given macos host computer", () => {
	describe("#when instantiated", () => {
		it("#then has correct capabilities", () => {
			const computer = new MacOSHostComputer();
			expect(computer.capabilities.supportsScreenshot).toBe(true);
			expect(computer.capabilities.supportsInput).toBe(true);
			expect(computer.capabilities.supportsAccessibility).toBe(true);
			expect(computer.capabilities.supportsClipboard).toBe(true);
		});
	});
});
