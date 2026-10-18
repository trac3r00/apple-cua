import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCursorIdentity } from "../../computer/cursor-scope.js";
import type { Point, Rect } from "../../types/index.js";
import {
	CURSOR_MOTION_ENV,
	type CursorMotionConfig,
	cursorMotionFromEnvironment,
	parseCursorMotion,
} from "./cursor-motion-config.js";
import { prepareCursorMotion } from "./cursor-motion.js";

/** "click" is an event rather than a lasting mode: the overlay ripples where the dot lands. */
export type PointerMode = "pointer" | "scroll" | "thinking" | "keyboard" | "click";

export interface PointerOverlay {
	set(point: Point, pid?: number, direct?: boolean): void;
	/** Already-paced input samples must not start another glide behind the real gesture. */
	track?(point: Point, pid?: number): void;
	highlight(rect: Rect, pid?: number): void;
	setMode(mode: PointerMode, pid?: number): void;
	hide(pid?: number): void;
	close(): void;
}

// A transport carries newline-terminated commands ("set x y\n", "highlight ...\n",
// "hide\n") to the overlay. The default transport talks to a persistent unix-socket
// daemon so the cursor survives across separate CLI commands (each apple-cua verb is
// its own short-lived process); tests inject a fake transport to capture commands.
export interface OverlayTransport {
	send(command: string, pid?: number, direct?: boolean): void;
	close(): void;
}

export type OverlayTransportFactory = (identity?: string) => OverlayTransport | undefined;

export const NOOP_POINTER_OVERLAY: PointerOverlay = {
	set(): void {
		/* no-op */
	},
	highlight(): void {
		/* no-op */
	},
	setMode(): void {
		/* no-op */
	},
	hide(): void {
		/* no-op */
	},
	close(): void {
		/* no-op */
	},
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const overlayBinaryCandidatePaths: readonly string[] = [
	join(moduleDirectory, "../../../native/cursor-overlay"),
	join(moduleDirectory, "../../../../native/cursor-overlay"),
	join(moduleDirectory, "../../native/cursor-overlay"),
];

// Each process has its own daemon unless callers supply a stable cursor identity.
const DEFAULT_CURSOR_IDENTITY = `process-${process.pid}`;

export function cursorOverlaySocketPath(
	identity = process.env["APPLE_CUA_CURSOR_ID"] ?? DEFAULT_CURSOR_IDENTITY,
): string {
	if (
		identity.length === 0 ||
		identity.length > 1_024 ||
		Array.from(identity).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	) {
		throw new Error("APPLE_CUA_CURSOR_ID must be a non-empty identity without control characters");
	}
	// macOS sun_path holds 104 bytes including its terminator. Keep the filename
	// short enough for the per-user /var/folders temporary directory.
	const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
	return join(tmpdir(), `ac-${digest}.sock`);
}
// Long enough to stay visible across a multi-step agent session (vision steps take
// a few seconds each) so the cursor glides continuously instead of fading out and
// back in between commands; still self-cleans when the session truly ends.
const overlayIdleSeconds = "15";
// The daemon exits after that idle time, so a later command can find nobody listening again and
// must start a fresh one. Spawns are spaced by this much so the first command's retries (150 ms
// apart) never start duplicates while one daemon is still binding its socket.
const DAEMON_RESPAWN_GUARD_MILLISECONDS = 1_000;

export function createCursorOverlay(
	transportFactory?: OverlayTransportFactory,
	motion?: CursorMotionConfig | null,
): PointerOverlay {
	const environmentMotion = process.env[CURSOR_MOTION_ENV]?.trim();
	// Default the renderer, not the shared parser used by persisted CLI settings.
	const configuration =
		motion !== undefined
			? parseCursorMotion(motion)
			: environmentMotion === undefined || environmentMotion === ""
				? { style: "adaptive" as const }
				: cursorMotionFromEnvironment();
	const transportsByIdentity = new Map<string | undefined, OverlayTransport | undefined>();
	const pidsByIdentity = new Map<string | undefined, Set<number>>();

	function send(command: string, pid?: number, direct = false): void {
		const identity = currentCursorIdentity();
		if (pid !== undefined) {
			let pids = pidsByIdentity.get(identity);
			if (pids === undefined) {
				pids = new Set<number>();
				pidsByIdentity.set(identity, pids);
			}
			pids.add(pid);
		}
		if (!transportsByIdentity.has(identity)) {
			transportsByIdentity.set(
				identity,
				safeTransport(
					transportFactory ??
						((scopedIdentity) =>
							defaultSocketTransport(Date.now, spawn, configuration, cursorOverlaySocketPath(scopedIdentity))),
					identity,
				),
			);
		}
		try {
			transportsByIdentity.get(identity)?.send(command, pid, direct);
		} catch {
			/* best-effort overlay */
		}
	}

	return {
		set(point: Point, pid?: number, direct?: boolean): void {
			send(`set ${Math.round(point.x)} ${Math.round(point.y)}\n`, pid, direct);
		},
		track(point: Point, pid?: number): void {
			send(`track ${Math.round(point.x)} ${Math.round(point.y)}\n`, pid, true);
		},
		highlight(rect: Rect, pid?: number): void {
			send(
				`highlight ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)}\n`,
				pid,
			);
		},
		setMode(mode: PointerMode, pid?: number): void {
			send(`mode ${mode}\n`, pid);
		},
		hide(pid?: number): void {
			send("hide\n", pid);
		},
		close(): void {
			for (const [identity, pids] of pidsByIdentity) {
				for (const pid of pids) {
					try {
						transportsByIdentity.get(identity)?.send("hide\n", pid);
					} catch {
						/* best-effort overlay */
					}
				}
			}
			// Intentionally does NOT stop the daemon — it is shared across commands and
			// self-terminates on its idle timeout. Closing here would kill the cursor
			// the moment a single verb's process exits (the original "never showed" bug).
			for (const transport of new Set(transportsByIdentity.values())) {
				try {
					transport?.close();
				} catch {
					/* shared daemon outlives this command */
				}
			}
		},
	};
}

function safeTransport(factory: OverlayTransportFactory, identity: string | undefined): OverlayTransport | undefined {
	try {
		return factory(identity);
	} catch {
		return undefined;
	}
}

function overlayBinaryPath(): string | undefined {
	return overlayBinaryCandidatePaths.find((candidate) => existsSync(candidate));
}

// Default transport: send each command over a short-lived connection to the shared
// overlay daemon, spawning the daemon (detached) whenever no one is listening.
export type SpawnOverlayProcess = (
	command: string,
	args: readonly string[],
	options: { readonly detached: boolean; readonly stdio: "ignore" },
) => {
	on(event: "error", listener: (error: Error) => void): unknown;
	unref(): void;
};

export function defaultSocketTransport(
	now: () => number = Date.now,
	spawnProcess: SpawnOverlayProcess = spawn,
	motion?: CursorMotionConfig,
	socketPath = cursorOverlaySocketPath(),
): OverlayTransport {
	let lastSpawnAt = Number.NEGATIVE_INFINITY;
	// A binary that cannot be executed (ENOENT/EACCES) will not become executable by retrying every
	// second, so one failure turns daemon spawning off; the overlay then stays a silent no-op.
	let spawnFailed = false;

	function ensureDaemon(): void {
		if (spawnFailed) {
			return;
		}
		const time = now();
		if (time - lastSpawnAt < DAEMON_RESPAWN_GUARD_MILLISECONDS) {
			return;
		}
		lastSpawnAt = time;
		const binaryPath = overlayBinaryPath();
		if (binaryPath === undefined) {
			return;
		}
		try {
			const child = spawnProcess(binaryPath, ["--socket", socketPath, "--idle", overlayIdleSeconds], {
				detached: true,
				stdio: "ignore",
			});
			// Spawn failures such as ENOENT arrive asynchronously as an 'error' event; without a listener
			// Node rethrows it as an uncaught exception and takes the whole server down.
			child.on("error", (error: Error) => {
				if (!spawnFailed) {
					spawnFailed = true;
					process.stderr.write(`apple-cua: cursor overlay unavailable, continuing without it: ${error.message}\n`);
				}
			});
			child.unref();
		} catch {
			/* unavailable overlay is non-fatal */
		}
	}

	function deliver(command: string, attempt: number, finished?: () => void, direct = false): void {
		let socket: ReturnType<typeof connect>;
		try {
			socket = connect(socketPath);
		} catch {
			ensureDaemon();
			finished?.();
			return;
		}
		let retrying = false;
		socket.on("close", () => {
			if (!retrying) {
				finished?.();
			}
		});
		socket.on("connect", () => {
			if (!direct && motion !== undefined && /^set /.test(command)) {
				socket.setTimeout(2_000, () => socket.destroy(new Error("Cursor overlay state request timed out")));
				void prepareCursorMotion(socket, command, motion).then(
					(prepared) => socket.end(prepared),
					(error: unknown) => {
						process.stderr.write(
							`apple-cua: cursor motion unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
						);
						socket.destroy();
					},
				);
				return;
			}
			try {
				socket.write(command);
				socket.end();
			} catch {
				/* socket failure is handled by its error event */
			}
		});
		socket.on("error", () => {
			// No daemon listening yet — start one and retry briefly so the very first
			// command still lands once the daemon has bound its socket.
			try {
				socket.destroy();
			} catch {
				/* continue daemon startup after a failed destroy */
			}
			ensureDaemon();
			if (attempt < 2) {
				retrying = true;
				setTimeout(() => deliver(command, attempt + 1, finished, direct), 150);
			}
		});
	}

	const pending: Array<{ readonly command: string; readonly direct: boolean }> = [];
	let sending = false;
	function sendNext(): void {
		const next = pending.shift();
		if (next === undefined) {
			sending = false;
			return;
		}
		deliver(next.command, 0, sendNext, next.direct);
	}

	return {
		send(command: string, pid?: number, direct = false): void {
			// PID markers are direct-update lanes: querying state and planning a
			// trajectory for every drag sample would queue stale positions behind input.
			const directUpdate = direct || pid !== undefined;
			const directCommand = directUpdate ? command.replace(/^set /, "set-direct ") : command;
			const scoped = pid === undefined ? directCommand : `pid ${pid} ${directCommand}`;
			if (motion === undefined) {
				deliver(scoped, 0, undefined, directUpdate);
				return;
			}
			pending.push({ command: scoped, direct: directUpdate });
			if (!sending) {
				sending = true;
				sendNext();
			}
		},
		close(): void {
			/* shared daemon outlives this transport */
		},
	};
}
