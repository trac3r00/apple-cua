import {
	constants,
	type Dirent,
	closeSync,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import type { HistoryPaths } from "./history-control.js";
import { SEGMENT_WINDOW_MS, segmentStartMs } from "./history-store.js";

export interface HistorySegmentSummary {
	readonly id: string;
	readonly startedAt: string;
	readonly endedAt: string;
	/** Lines in events.jsonl, which is what the segment actually holds (metadata can lag a crash). */
	readonly eventCount: number;
	/** Apps seen in the segment, most frequent first, at most five. */
	readonly apps: readonly string[];
}

/** Which segments to delete: exact ids, every segment that overlaps the last `withinMs`, or all of them. */
export type HistoryDeletion =
	| { readonly ids: readonly string[] }
	| { readonly withinMs: number }
	| { readonly all: true };

// The recorder names a segment by its window start, which falls on a 10-minute boundary.
const SEGMENT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-[0-5]0-00Z$/;
const MAX_EVENTS_BYTES = 8 * 1024 * 1024;
const MAX_LISTED_APPS = 5;

export function isHistorySegmentId(value: string): boolean {
	return SEGMENT_ID.test(value) && segmentStartMs(value) !== undefined;
}

/** Real segment directories only: a symlink or a stray name in segments/ is never listed, so never deleted. */
function segmentIds(paths: HistoryPaths): string[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(paths.segmentsDir, { withFileTypes: true });
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return [];
		}
		throw error;
	}
	return entries.filter((entry) => entry.isDirectory() && isHistorySegmentId(entry.name)).map((entry) => entry.name);
}

/** Reads a regular file without following a symlink, up to `limit` bytes. */
function readRegularFile(path: string, limit: number): string | undefined {
	let descriptor: number;
	try {
		descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch {
		return undefined;
	}
	try {
		const stats = fstatSync(descriptor);
		if (!stats.isFile()) {
			return undefined;
		}
		const buffer = Buffer.alloc(Math.min(stats.size, limit));
		const read = readSync(descriptor, buffer, 0, buffer.length, 0);
		return buffer.subarray(0, read).toString("utf8");
	} finally {
		closeSync(descriptor);
	}
}

function summarize(paths: HistoryPaths, id: string): HistorySegmentSummary {
	const start = segmentStartMs(id) ?? 0;
	const text = readRegularFile(join(paths.segmentsDir, id, "events.jsonl"), MAX_EVENTS_BYTES) ?? "";
	const appCounts = new Map<string, number>();
	let eventCount = 0;
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) {
			continue;
		}
		eventCount += 1;
		try {
			const event: unknown = JSON.parse(line);
			const app = typeof event === "object" && event !== null ? Reflect.get(event, "app") : undefined;
			const name = typeof app === "object" && app !== null ? Reflect.get(app, "name") : undefined;
			if (typeof name === "string" && name.length > 0) {
				appCounts.set(name, (appCounts.get(name) ?? 0) + 1);
			}
		} catch {
			// A torn last line from a crash still counts as recorded; it just names no app.
		}
	}
	const apps = [...appCounts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, MAX_LISTED_APPS)
		.map(([name]) => name);
	return {
		id,
		startedAt: new Date(start).toISOString(),
		endedAt: new Date(start + SEGMENT_WINDOW_MS).toISOString(),
		eventCount,
		apps,
	};
}

export function listHistorySegments(paths: HistoryPaths): HistorySegmentSummary[] {
	return segmentIds(paths)
		.sort((left, right) => right.localeCompare(left))
		.map((id) => summarize(paths, id));
}

/**
 * Deletes recorded segments and returns the ids removed, newest first. Exact ids are checked first, so a typo or a
 * path such as `../x` fails before anything is removed; only real directories directly inside segments/ go.
 */
export function deleteHistorySegments(
	paths: HistoryPaths,
	deletion: HistoryDeletion,
	now: number = Date.now(),
): string[] {
	const present = new Set(segmentIds(paths));
	let selected: string[];
	if ("ids" in deletion) {
		for (const id of deletion.ids) {
			if (!isHistorySegmentId(id)) {
				throw new Error(`"${id}" is not a history segment id; run opencua history list to see them`);
			}
			if (!present.has(id)) {
				throw new Error(`No history segment ${id}; run opencua history list to see them`);
			}
		}
		selected = [...new Set(deletion.ids)];
	} else if ("withinMs" in deletion) {
		if (!Number.isFinite(deletion.withinMs) || deletion.withinMs <= 0) {
			throw new Error("The period to delete must be a positive duration");
		}
		const cutoff = now - deletion.withinMs;
		selected = [...present].filter((id) => (segmentStartMs(id) ?? 0) + SEGMENT_WINDOW_MS > cutoff);
	} else {
		selected = [...present];
	}
	selected.sort((left, right) => right.localeCompare(left));
	for (const id of selected) {
		const target = join(paths.segmentsDir, id);
		// Checked again right before removal: the directory must still be a real directory, not a swapped-in link.
		if (!lstatSync(target).isDirectory()) {
			throw new Error(`History segment ${id} is no longer a directory; nothing more was deleted`);
		}
		rmSync(target, { recursive: true, force: true });
	}
	return selected;
}

/** Parses a duration such as 15m, 2h or 1d for `opencua history delete --last`. */
export function parseHistoryDuration(value: string): number {
	const match = /^(\d+)([mhd])$/.exec(value.trim());
	const amount = match === null ? Number.NaN : Number(match[1]);
	if (match === null || !Number.isSafeInteger(amount) || amount <= 0) {
		throw new Error(`"${value}" is not a duration; use minutes, hours or days such as 15m, 2h or 1d`);
	}
	const unit = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
	return amount * unit;
}
