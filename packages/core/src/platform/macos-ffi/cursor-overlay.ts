import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Point, Rect } from "../../types/index.js";

export interface PointerOverlay {
	set(point: Point): void;
	highlight(rect: Rect): void;
	hide(): void;
	close(): void;
}

export interface OverlayProcessHandle {
	readonly stdin: { write(chunk: string): void; end(): void } | null;
	kill(): void;
}

export type OverlaySpawner = () => OverlayProcessHandle | undefined;

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

export function createCursorOverlay(spawner: OverlaySpawner = defaultSpawner): PointerOverlay {
	let handle: OverlayProcessHandle | undefined;
	let spawned = false;

	function send(command: string): void {
		if (!spawned) {
			spawned = true;
			handle = safeSpawn(spawner);
		}
		try {
			handle?.stdin?.write(command);
		} catch {}
	}

	return {
		set(point: Point): void {
			send(`set ${Math.round(point.x)} ${Math.round(point.y)}\n`);
		},
		highlight(rect: Rect): void {
			send(`highlight ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)}\n`);
		},
		hide(): void {
			send("hide\n");
		},
		close(): void {
			if (handle === undefined) {
				return;
			}
			try {
				handle.stdin?.write("quit\n");
				handle.stdin?.end();
			} catch {}
		},
	};
}

function safeSpawn(spawner: OverlaySpawner): OverlayProcessHandle | undefined {
	try {
		return spawner();
	} catch {
		return undefined;
	}
}

function defaultSpawner(): OverlayProcessHandle | undefined {
	const binaryPath = overlayBinaryCandidatePaths.find((candidate) => existsSync(candidate));
	if (binaryPath === undefined) {
		return undefined;
	}
	try {
		return spawn(binaryPath, [], { stdio: ["pipe", "ignore", "ignore"] });
	} catch {
		return undefined;
	}
}
