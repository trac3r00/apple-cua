import { describe, expect, it } from "bun:test";
import { GuardedPlatformComputer, MacOSHostComputer } from "@opencua/core";
import { createNativeComputer } from "./native-policy.js";

describe("#given the host OS #when the native computer is created #then the matching backend is guarded", () => {
	it.each(["linux", "win32"] as const)(
		"wraps the %s backend in the observation guard without spawning it",
		async (platform) => {
			const computer = createNativeComputer(platform);
			expect(computer).toBeInstanceOf(GuardedPlatformComputer);
			expect(computer.delivery).toBe("background");
			expect(computer.getInputObservation(1)).toBeUndefined();
			await computer.close();
		},
	);

	it("keeps the macOS host computer on darwin", async () => {
		const computer = createNativeComputer("darwin");
		expect(computer).toBeInstanceOf(MacOSHostComputer);
		await computer.close();
	});
});
