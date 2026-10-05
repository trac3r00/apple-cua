import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./fixture.mjs";

export function desktopProbe() {
	const binary = path.join(ROOT, `desktop-state-${randomUUID()}`);
	const source = fileURLToPath(new URL("./desktop-state.swift", import.meta.url));
	execFileSync("swiftc", [source, "-o", binary], { timeout: 60000 });
	return {
		read() {
			const state = JSON.parse(execFileSync(binary, { encoding: "utf8", timeout: 10000 }));
			if (!state.app || !Number.isFinite(state.x) || !Number.isFinite(state.y))
				throw new Error("invalid desktop state");
			return state;
		},
		snapshot() {
			return JSON.parse(execFileSync(binary, ["snapshot"], { encoding: "utf8", timeout: 10000 }));
		},
		checkWindow(pid, title) {
			execFileSync(binary, ["check", String(pid), title], { timeout: 10000 });
		},
		closeWindow(pid, title) {
			execFileSync(binary, ["close", String(pid), title], { timeout: 10000 });
		},
		// Cmd+W aimed at one window through apple-cua's own background keyboard route. Measured to work
		// in an off-console session, where AppleScript window scripting and accessibility do not.
		async closeWindowByNumber(bundleId, pid, number) {
			const { AppApprovalStore, MacOSHostComputer, NOOP_POINTER_OVERLAY } = await import(
				"../../packages/core/dist/index.js"
			);
			const computer = new MacOSHostComputer({
				delivery: "background",
				overlay: NOOP_POINTER_OVERLAY,
				appApproval: new AppApprovalStore([bundleId]),
			});
			try {
				computer.setTarget(pid);
				await computer.getAppState(pid, { windowId: number, settleMs: 0, includeScreenshot: false });
				await computer.key("w", { modifiers: ["cmd"] });
			} finally {
				await computer.close();
			}
		},
		// A key to an app's key window through the same background keyboard route, to dismiss a modal
		// alert an attempt left behind (it is invisible off-console and blocks the app's scripting).
		async pressKey(bundleId, pid, key, windowNumber) {
			const { AppApprovalStore, MacOSHostComputer, NOOP_POINTER_OVERLAY } = await import(
				"../../packages/core/dist/index.js"
			);
			const computer = new MacOSHostComputer({
				delivery: "background",
				overlay: NOOP_POINTER_OVERLAY,
				appApproval: new AppApprovalStore([bundleId]),
			});
			try {
				computer.setTarget(pid);
				await computer.getAppState(pid, { windowId: windowNumber, settleMs: 0, includeScreenshot: false });
				await computer.key(key);
			} finally {
				await computer.close();
			}
		},
		// A menu item pressed through accessibility, which keeps working off-console where window
		// scripting does not. Fixture use only (it changes state around the driver, not for it).
		async invokeMenu(_bundleId, pid, menuPath) {
			const { invokeMenu } = await import("../../packages/core/dist/index.js");
			await invokeMenu(pid, menuPath);
		},
		close() {
			rmSync(binary, { force: true });
		},
	};
}
