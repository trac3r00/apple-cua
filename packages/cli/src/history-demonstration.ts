import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";
import { listHistoryTimeline, readHistoryEvidence } from "./history-workflows.js";

const MAX_MARKER_BYTES = 16_384;
const MAX_DEMONSTRATION_MILLISECONDS = 90 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stopping = new Set<string>();

export type HistoryDemonstration = {
	readonly id: string;
	readonly startedAt: string;
	readonly endedAt?: string;
	readonly sourceIds: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value) &&
		!Number.isNaN(Date.parse(value))
	);
}

function parseMarker(value: unknown, id: string): HistoryDemonstration {
	const marker = z
		.object({
			id: z.literal(id),
			startedAt: z.string().refine(isIsoDate),
			endedAt: z.string().refine(isIsoDate).optional(),
			sourceIds: z.array(z.string()).max(12),
		})
		.safeParse(value);
	if (!marker.success) {
		throw new Error(`Invalid history demonstration marker "${id}".`);
	}
	return {
		id: marker.data.id,
		startedAt: marker.data.startedAt,
		sourceIds: marker.data.sourceIds,
		...(marker.data.endedAt === undefined ? {} : { endedAt: marker.data.endedAt }),
	};
}

async function assertDirectory(path: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new Error(`History demonstrations path must be a real directory: ${path}`);
	}
}

async function readMarker(root: string, id: string): Promise<HistoryDemonstration> {
	if (!UUID.test(id)) {
		throw new Error("History demonstration ID must be a UUID.");
	}
	const directory = join(root, "demonstrations");
	await assertDirectory(directory);
	const path = join(directory, `${id}.json`);
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_MARKER_BYTES) {
		throw new Error(`Invalid history demonstration marker file "${id}".`);
	}
	let value: unknown;
	try {
		value = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Malformed history demonstration marker "${id}".`);
		}
		throw error;
	}
	return parseMarker(value, id);
}

async function assertRunning(root: string): Promise<void> {
	const path = join(root, "state.json");
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_MARKER_BYTES) {
		throw new Error("History state must be a bounded regular file.");
	}
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(value) || value["state"] !== "running") {
		throw new Error("History recorder must be running to start a demonstration.");
	}
}

async function canonicalRoot(root: string): Promise<string> {
	await assertDirectory(root);
	return realpath(root);
}

function markerPath(root: string, id: string): string {
	if (!UUID.test(id)) {
		throw new Error("History demonstration ID must be a UUID.");
	}
	return join(root, "demonstrations", `${id}.json`);
}

async function writeMarker(path: string, demonstration: HistoryDemonstration, exclusive: boolean): Promise<void> {
	const handle = await open(path, exclusive ? "wx" : "w", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(demonstration, null, 2)}\n`, "utf8");
	} finally {
		await handle.close();
	}
}

async function createMarkerAtomically(path: string, demonstration: HistoryDemonstration): Promise<void> {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		await writeMarker(temporaryPath, demonstration, true);
		await link(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

export async function startHistoryDemonstration(root: string, now: number = Date.now()): Promise<HistoryDemonstration> {
	const canonical = await canonicalRoot(root);
	if (!Number.isFinite(now)) {
		throw new Error("History demonstration time must be finite.");
	}
	await assertRunning(canonical);
	const directory = join(canonical, "demonstrations");
	try {
		await mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if (!(isRecord(error) && error["code"] === "EEXIST")) {
			throw error;
		}
	}
	await assertDirectory(directory);
	const demonstration: HistoryDemonstration = {
		id: randomUUID(),
		startedAt: new Date(Math.floor(now / 1000) * 1000).toISOString(),
		sourceIds: [],
	};
	await createMarkerAtomically(markerPath(canonical, demonstration.id), demonstration);
	return demonstration;
}

export async function stopHistoryDemonstration(
	root: string,
	id: string,
	now: number = Date.now(),
): Promise<HistoryDemonstration> {
	const canonical = await canonicalRoot(root);
	if (!Number.isFinite(now)) {
		throw new Error("History demonstration time must be finite.");
	}
	const key = markerPath(canonical, id);
	if (stopping.has(key)) {
		throw new Error(`History demonstration "${id}" is already stopping.`);
	}
	stopping.add(key);
	try {
		const current = await readMarker(canonical, id);
		if (current.endedAt !== undefined) {
			throw new Error(`History demonstration "${id}" has already stopped.`);
		}
		const start = Date.parse(current.startedAt);
		if (now < start) {
			throw new Error("History demonstration stop time cannot precede its start time.");
		}
		const endedAt = new Date(Math.ceil(now / 1000) * 1000).toISOString();
		if (Date.parse(endedAt) - start > MAX_DEMONSTRATION_MILLISECONDS) {
			throw new Error("History demonstration cannot exceed 90 minutes.");
		}
		const segments = await listHistoryTimeline(canonical);
		const intersecting = segments.filter(
			(segment) => Date.parse(segment.startedAt) < Date.parse(endedAt) && Date.parse(segment.endedAt) > start,
		);
		if (intersecting.length > 12) {
			throw new Error("History demonstration intersects more than 12 history segments.");
		}
		const stopped: HistoryDemonstration = {
			...current,
			endedAt,
			sourceIds: intersecting.map((segment) => segment.id),
		};
		const path = markerPath(canonical, id);
		const temporaryPath = `${path}.${randomUUID()}.tmp`;
		try {
			await writeMarker(temporaryPath, stopped, true);
			await rename(temporaryPath, path);
		} catch (error) {
			await rm(temporaryPath, { force: true });
			throw error;
		}
		return stopped;
	} finally {
		stopping.delete(key);
	}
}

export async function readHistoryDemonstrationEvidence(root: string, id: string): Promise<string> {
	const canonical = await canonicalRoot(root);
	const demonstration = await readMarker(canonical, id);
	if (demonstration.endedAt === undefined) {
		throw new Error(`History demonstration "${id}" has not stopped.`);
	}
	const evidence = await readHistoryEvidence(canonical, demonstration.sourceIds);
	const lines = evidence.split("\n").filter((line) => !line.startsWith("## "));
	const selected: string[] = [];
	for (const line of lines) {
		if (line.length === 0) {
			continue;
		}
		const event: unknown = JSON.parse(line);
		if (
			isRecord(event) &&
			typeof event["timestamp"] === "string" &&
			Date.parse(event["timestamp"]) >= Date.parse(demonstration.startedAt) &&
			Date.parse(event["timestamp"]) < Date.parse(demonstration.endedAt)
		) {
			selected.push(line);
		}
	}
	if (selected.length === 0) {
		throw new Error("History demonstration contains no events in its selected time boundaries.");
	}
	return [
		"History demonstration evidence",
		`Start boundary: ${demonstration.startedAt}`,
		`End boundary: ${demonstration.endedAt}`,
		"Boundaries are second-resolution; event timestamps are filtered in [start, end).",
		...selected,
	].join("\n");
}
