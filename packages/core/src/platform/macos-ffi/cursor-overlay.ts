import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Point, Rect } from "../../types/index.js";

export interface PointerOverlay {
	set(point: Point): void;
	highlight(rect: Rect): void;
	hide(): void;
	close(): void;
}

// A transport carries newline-terminated commands ("set x y\n", "highlight ...\n",
// "hide\n") to the overlay. The default transport talks to a persistent unix-socket
// daemon so the cursor survives across separate CLI commands (each macos-cua verb is
// its own short-lived process); tests inject a fake transport to capture commands.
export interface OverlayTransport {
	send(command: string): void;
	close(): void;
}

export type OverlayTransportFactory = () => OverlayTransport | undefined;

export const NOOP_POINTER_OVERLAY: PointerOverlay = {
	set(): void {},
	highlight(): void {},
	hide(): void {},
	close(): void {},
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const overlayBinaryCandidatePaths: readonly string[] = [
	join(moduleDirectory, "../../../native/cursor-overlay"),
	join(moduleDirectory, "../../../../native/cursor-overlay"),
	join(moduleDirectory, "../../native/cursor-overlay"),
];

// One shared daemon per user, keyed by a stable socket path. The daemon vanishes
// this many seconds after the last command, so it cleans itself up when a session
// ends but stays put while commands keep arriving.
const overlaySocketPath = join(tmpdir(), "macos-cua-cursor.sock");
const overlayIdleSeconds = "5";

export function createCursorOverlay(
	transportFactory: OverlayTransportFactory = defaultSocketTransport,
): PointerOverlay {
	let transport: OverlayTransport | undefined;
	let resolved = false;

	function send(command: string): void {
		if (!resolved) {
			resolved = true;
			transport = safeTransport(transportFactory);
		}
		try {
			transport?.send(command);
		} catch {}
	}

	return {
		set(point: Point): void {
			send(`set ${Math.round(point.x)} ${Math.round(point.y)}\n`);
		},
		highlight(rect: Rect): void {
			send(
				`highlight ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)}\n`,
			);
		},
		hide(): void {
			send("hide\n");
		},
		close(): void {
			// Intentionally does NOT stop the daemon — it is shared across commands and
			// self-terminates on its idle timeout. Closing here would kill the cursor
			// the moment a single verb's process exits (the original "never showed" bug).
			try {
				transport?.close();
			} catch {}
		},
	};
}

function safeTransport(factory: OverlayTransportFactory): OverlayTransport | undefined {
	try {
		return factory();
	} catch {
		return undefined;
	}
}

function overlayBinaryPath(): string | undefined {
	return overlayBinaryCandidatePaths.find((candidate) => existsSync(candidate));
}

// Default transport: send each command over a short-lived connection to the shared
// overlay daemon, spawning the daemon (detached) the first time no one is listening.
function defaultSocketTransport(): OverlayTransport {
	let daemonEnsured = false;

	function ensureDaemon(): void {
		if (daemonEnsured) {
			return;
		}
		daemonEnsured = true;
		const binaryPath = overlayBinaryPath();
		if (binaryPath === undefined) {
			return;
		}
		try {
			const child = spawn(
				binaryPath,
				["--socket", overlaySocketPath, "--idle", overlayIdleSeconds],
				{ detached: true, stdio: "ignore" },
			);
			child.unref();
		} catch {}
	}

	function deliver(command: string, attempt: number): void {
		let socket: ReturnType<typeof connect>;
		try {
			socket = connect(overlaySocketPath);
		} catch {
			ensureDaemon();
			return;
		}
		socket.on("connect", () => {
			try {
				socket.write(command);
				socket.end();
			} catch {}
		});
		socket.on("error", () => {
			// No daemon listening yet — start one and retry briefly so the very first
			// command still lands once the daemon has bound its socket.
			try {
				socket.destroy();
			} catch {}
			ensureDaemon();
			if (attempt < 2) {
				setTimeout(() => deliver(command, attempt + 1), 150);
			}
		});
	}

	return {
		send(command: string): void {
			deliver(command, 0);
		},
		close(): void {},
	};
}
