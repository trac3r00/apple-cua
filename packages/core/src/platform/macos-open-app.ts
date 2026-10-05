import { spawn } from "node:child_process";
import type { AppInfo } from "../accessibility/types.js";
import { findMatchingApp } from "../computer/actions.js";

/** Launches or activates an application by name or bundle id. */
export interface AppOpenLauncher {
	launch(target: string): Promise<void>;
	/** True when launching leaves the app in the background instead of bringing it forward. */
	readonly background?: boolean;
}

export interface AppLister {
	listApps(): Promise<AppInfo[]>;
}

export interface OpenApplicationOptions {
	/** How long to wait for a launched app to become observable. */
	readonly timeoutMs?: number;
	readonly pollIntervalMs?: number;
	readonly launcher?: AppOpenLauncher;
}

export interface OpenApplicationResult {
	readonly name: string;
	readonly bundleId: string;
	readonly pid: number;
	/** True when the app had to be launched; false when it was already running. */
	readonly launched: boolean;
	/** True when an already running app was brought forward instead of launched. */
	readonly activated: boolean;
}

const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_POLL_INTERVAL_MILLISECONDS = 200;
const BUNDLE_ID_SHAPE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * A bundle id goes to open -b, an app name to open -a. In the background, -g launches the app
 * without bringing it forward, so opening it does not take focus from the person at the Mac.
 */
export function openArguments(target: string, background = false): readonly string[] {
	return [...(background ? ["-g"] : []), ...(BUNDLE_ID_SHAPE.test(target) ? ["-b", target] : ["-a", target])];
}

export function spawnOpenLauncher(options: { readonly background?: boolean } = {}): AppOpenLauncher {
	const background = options.background === true;
	return {
		background,
		async launch(target: string): Promise<void> {
			const args = [...openArguments(target, background)];
			await new Promise<void>((resolve, reject) => {
				const child = spawn("open", args, { stdio: ["ignore", "ignore", "pipe"] });
				let stderr = "";
				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString("utf8");
				});
				child.once("error", reject);
				child.once("close", (code) => {
					if (code === 0) {
						resolve();
						return;
					}
					reject(new Error(stderr.trim().length > 0 ? stderr.trim() : `open exited with code ${String(code)}`));
				});
			});
		},
	};
}

function delayMilliseconds(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/**
 * Open an app the way a person means it: if it is running, bring it forward; if it is not,
 * launch it and wait until it is actually observable, so the caller's next observation sees a
 * real window instead of racing the launch. The answer always names what open did and which
 * process the caller can now observe.
 */
export async function openApplication(
	lister: AppLister,
	name: string,
	options: OpenApplicationOptions = {},
): Promise<OpenApplicationResult> {
	const launcher = options.launcher ?? spawnOpenLauncher();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MILLISECONDS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MILLISECONDS;
	const running = findMatchingApp(await lister.listApps(), name);
	await launcher.launch(running?.bundleId ?? name);
	if (running !== undefined) {
		return {
			name: running.name,
			bundleId: running.bundleId,
			pid: running.pid,
			launched: false,
			activated: launcher.background !== true,
		};
	}
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const appeared = findMatchingApp(await lister.listApps(), name);
		if (appeared !== undefined) {
			return {
				name: appeared.name,
				bundleId: appeared.bundleId,
				pid: appeared.pid,
				launched: true,
				activated: false,
			};
		}
		if (Date.now() >= deadline) {
			throw new Error(`"${name}" did not appear as a running app within ${timeoutMs} ms of being opened`);
		}
		await delayMilliseconds(pollIntervalMs);
	}
}
