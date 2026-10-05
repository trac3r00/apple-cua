import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MacOSHostComputer } from "./macos.js";

/**
 * The wedge, reproduced. An app that is stopped cannot answer an accessibility message, which is
 * what a busy app looks like to the driver: the call used to block with no reply, and every later
 * observation of that app timed out behind it. With a finite messaging timeout the same call fails
 * bounded, naming the cause.
 *
 * Opt-in because it stops a real process: APPLE_CUA_LIVE_AX=1, target app in APPLE_CUA_LIVE_AX_APP.
 */
const enabled = process.env["APPLE_CUA_LIVE_AX"] === "1";
const appName = process.env["APPLE_CUA_LIVE_AX_APP"] ?? "TextEdit";

function signal(pid: number, name: "STOP" | "CONT"): void {
	try {
		execFileSync("kill", [`-${name}`, String(pid)]);
	} catch {
		return;
	}
}

describe.skipIf(!enabled)("#given an app that stops answering accessibility messages", () => {
	it("#when it is observed #then the call fails bounded instead of hanging", async () => {
		const computer = new MacOSHostComputer();
		try {
			const apps = await computer.listApps();
			const app = apps.find((entry) => entry.name === appName || entry.bundleId === appName);
			expect(app, `${appName} must be running for this probe`).toBeDefined();
			const pid = app?.pid ?? 0;

			await computer.getAppState(pid, { includeScreenshot: false });

			signal(pid, "STOP");
			const resume = setTimeout(() => signal(pid, "CONT"), 15_000);
			const started = Date.now();
			let failure: string | undefined;
			try {
				await computer.getAppState(pid, { includeScreenshot: false });
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			} finally {
				clearTimeout(resume);
				signal(pid, "CONT");
			}
			const stoppedMs = Date.now() - started;

			expect(failure, "a stopped app must not be observed silently").toBeDefined();
			expect(stoppedMs, "the observation must fail bounded, not hang").toBeLessThan(8_000);
			expect(`${failure}`).toMatch(/messaging timeout/i);
		} finally {
			await computer.close();
		}
	}, 60_000);
});
