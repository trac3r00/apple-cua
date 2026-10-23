import { describe, expect, it, vi } from "vitest";
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

	it("rejects a nonnumeric process identifier before polling", async () => {
		const script = vi.fn(async () => "not-a-pid");
		await expect(windowsGuestDisplay(script, "const v = {};")).rejects.toThrow("process identifier");
		expect(script).toHaveBeenCalledTimes(1);
	});

	it("requests termination through the cleanup channel when polling is interrupted", async () => {
		let call = 0;
		let cleanupCalls = 0;
		const cleanup = vi.fn(async () => (++cleanupCalls === 1 ? "99" : JSON.stringify({ exited: true, exitCode: 0 })));
		await expect(
			windowsGuestDisplay(
				async () => {
					if (++call === 1) return "42";
					throw new Error("cancelled");
				},
				"const v = {};",
				{ x: 10, y: 20 },
				cleanup,
			),
		).rejects.toThrow("cancelled");
		expect(cleanup).toHaveBeenCalledWith(expect.stringContaining('"/PID","42","/T","/F"'));
		expect(cleanup).toHaveBeenCalledWith(expect.stringContaining("guestProcesses.byId(99)"));
	});

	it("waits for confirmed termination before rejecting interrupted input", async () => {
		let release: (value: string) => void = () => undefined;
		let observed: () => void = () => undefined;
		const cleanupReached = new Promise<void>((resolve) => {
			observed = resolve;
		});
		const cleanupResult = new Promise<string>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		let cleaning = 0;
		let rejected = false;
		const result = windowsGuestDisplay(
			async () => {
				if (++calls === 1) return "42";
				throw new Error("stopped");
			},
			"const v = {};",
			{ x: 1, y: 2 },
			async () => {
				if (++cleaning === 1) return "99";
				observed();
				return cleanupResult;
			},
		).catch((error: unknown) => {
			rejected = true;
			throw error;
		});
		const assertion = expect(result).rejects.toThrow("stopped");
		await cleanupReached;
		expect(rejected).toBe(false);
		release(JSON.stringify({ exited: true, exitCode: 0 }));
		await assertion;
		expect(rejected).toBe(true);
	});
});
