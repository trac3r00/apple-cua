import { describe, expect, it } from "vitest";
import { windowsGuestDisplay } from "./utm-guest.js";

describe("#given a guest process #when its completed display query is read #then dimensions are parsed", () => {
	it("reads output from a stable guest process identity", async () => {
		const scripts: string[] = [];
		const size = await windowsGuestDisplay(async (body) => {
			scripts.push(body);
			return scripts.length === 1
				? "42"
				: JSON.stringify({ exited: true, exitCode: 0, outputText: "1920x1080\r\n" });
		}, "const v = {};");
		expect(size).toEqual({ width: 1920, height: 1080 });
		expect(scripts[1]).toContain("guestProcesses.byId(42)");
	});

	it.each(["0x768", "1024x0", "bad", "1920x1080\nunexpected"])(
		"rejects malformed guest dimensions %j",
		async (text) => {
			let call = 0;
			await expect(
				windowsGuestDisplay(async () => {
					call++;
					return call === 1 ? "42" : JSON.stringify({ exited: true, exitCode: 0, outputText: text });
				}, "const v = {};"),
			).rejects.toThrow("invalid display dimensions");
		},
	);

	it("propagates guest failures instead of inventing dimensions", async () => {
		let call = 0;
		await expect(
			windowsGuestDisplay(async () => {
				call++;
				return call === 1 ? "42" : JSON.stringify({ exited: true, exitCode: 2, outputText: "" });
			}, "const v = {};"),
		).rejects.toThrow("Guest display query failed");
	});
});
