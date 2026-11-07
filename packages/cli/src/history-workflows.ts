import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";
import { z } from "zod/v4";

const MAX_EVIDENCE_BYTES = 120_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SELECTED_IDS = 12;
const SEGMENT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

export const historyDraftSchema = z.object({
	name: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
	description: z.string().min(1).max(1024),
	body: z.string().min(1).max(24_000),
});

export type HistoryDraft = z.infer<typeof historyDraftSchema>;

export type HistoryTimelineEntry = {
	readonly id: string;
	readonly startedAt: string;
	readonly endedAt: string;
	readonly eventCount: number;
	readonly apps: readonly string[];
};

type Metadata = {
	readonly id: string;
	readonly startedAt: string;
	readonly endedAt: string;
	readonly eventCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
		return false;
	}
	return !Number.isNaN(Date.parse(value));
}

function isSegmentId(id: string): boolean {
	if (!SEGMENT_ID.test(id)) {
		return false;
	}
	const normalized = id.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/, "$1T$2:$3:$4Z");
	const timestamp = Date.parse(normalized);
	return (
		!Number.isNaN(timestamp) && new Date(timestamp).toISOString().replaceAll(":", "-").replace(".000Z", "Z") === id
	);
}

function redact(value: unknown, parentKey = ""): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => redact(item, parentKey));
	}
	if (!isRecord(value)) {
		return value;
	}
	const sanitized: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		if (key === "ax" || key === "value" || (key === "text" && parentKey !== "keyboard")) {
			continue;
		}
		sanitized[key] = key === "text" && parentKey === "keyboard" ? "[REDACTED]" : redact(item, key);
	}
	return sanitized;
}

function parseMetadata(value: unknown, id: string): Metadata {
	if (
		!isRecord(value) ||
		value["id"] !== id ||
		!isIsoDate(value["startedAt"]) ||
		!isIsoDate(value["endedAt"]) ||
		typeof value["eventCount"] !== "number" ||
		!Number.isSafeInteger(value["eventCount"]) ||
		value["eventCount"] < 0
	) {
		throw new Error(`Invalid history metadata for segment "${id}".`);
	}
	return {
		id,
		startedAt: value["startedAt"],
		endedAt: value["endedAt"],
		eventCount: value["eventCount"],
	};
}

async function assertDirectory(path: string, description: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isDirectory()) {
		throw new Error(`${description} must be a real directory.`);
	}
}

async function assertRegularFile(path: string): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink() || !info.isFile()) {
		throw new Error(`History evidence file is not a regular file: ${path}`);
	}
}

async function readBounded(path: string, maximum: number): Promise<Buffer> {
	await assertRegularFile(path);
	const handle = await open(path, "r");
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > maximum) {
			throw new Error(`History evidence file exceeds the ${maximum}-byte read limit: ${path}`);
		}
		const bytes = Buffer.alloc(info.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (bytesRead === 0) {
				throw new Error(`Truncated history evidence file: ${path}`);
			}
			offset += bytesRead;
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

async function checkedRoot(root: string): Promise<string> {
	await assertDirectory(root, "History root");
	const canonicalRoot = await realpath(root);
	const segmentsPath = join(canonicalRoot, "segments");
	try {
		await assertDirectory(segmentsPath, "History segments directory");
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			return canonicalRoot;
		}
		throw error;
	}
	return canonicalRoot;
}

async function ensureRealDirectoryTree(path: string): Promise<void> {
	const absolutePath = resolve(path);
	const root = parse(absolutePath).root;
	let current = root;
	for (const component of absolutePath.slice(root.length).split(sep).filter(Boolean)) {
		current = join(current, component);
		try {
			await assertDirectory(current, "Directory path");
		} catch (error) {
			if (!isNodeError(error, "ENOENT")) {
				throw error;
			}
			try {
				await mkdir(current, { mode: 0o700 });
			} catch (createError) {
				if (!isNodeError(createError, "EEXIST")) {
					throw createError;
				}
			}
			await assertDirectory(current, "Directory path");
		}
	}
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}

function assertContained(root: string, path: string): void {
	const pathFromRoot = relative(root, path);
	if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || resolve(path) !== path) {
		throw new Error("History path escapes its root.");
	}
}

async function readSegmentMetadata(root: string, id: string): Promise<Metadata> {
	const segmentPath = join(root, "segments", id);
	assertContained(root, segmentPath);
	await assertDirectory(segmentPath, `History segment "${id}"`);
	const metadataPath = join(segmentPath, "metadata.json");
	assertContained(root, metadataPath);
	try {
		const bytes = await readBounded(metadataPath, 16_384);
		return parseMetadata(JSON.parse(bytes.toString("utf8")), id);
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			throw new Error(`Missing history metadata for segment "${id}".`);
		}
		if (error instanceof SyntaxError) {
			throw new Error(`Malformed history metadata for segment "${id}".`);
		}
		throw error;
	}
}

async function readEvents(root: string, metadata: Metadata, remainingBytes: number): Promise<string> {
	const { id, eventCount } = metadata;
	const eventPath = join(root, "segments", id, "events.jsonl");
	assertContained(root, eventPath);
	let bytes: Buffer;
	try {
		bytes = await readBounded(eventPath, Math.min(MAX_FILE_BYTES, remainingBytes));
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			if (eventCount === 0) return "";
			throw new Error(`Missing history events for segment "${id}".`);
		}
		throw error;
	}
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const records: string[] = [];
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		if (line.length === 0 && index === lines.length - 1) {
			continue;
		}
		if (line.trim().length === 0) {
			throw new Error(`Malformed history evidence in segment "${id}" at line ${index + 1}.`);
		}
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`Malformed history evidence in segment "${id}" at line ${index + 1}.`);
		}
		if (!isRecord(value) || typeof value["kind"] !== "string" || !isIsoDate(value["timestamp"])) {
			throw new Error(`Invalid history event in segment "${id}" at line ${index + 1}.`);
		}
		records.push(JSON.stringify(redact(value)));
	}
	return records.join("\n");
}

export async function listHistoryTimeline(root: string): Promise<readonly HistoryTimelineEntry[]> {
	let canonicalRoot: string;
	try {
		canonicalRoot = await checkedRoot(root);
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			return [];
		}
		throw error;
	}
	const segmentsPath = join(canonicalRoot, "segments");
	let ids: string[];
	try {
		ids = await readdir(segmentsPath);
	} catch (error) {
		if (isNodeError(error, "ENOENT")) {
			return [];
		}
		throw error;
	}
	const entries: HistoryTimelineEntry[] = [];
	for (const id of ids) {
		if (!isSegmentId(id)) {
			continue;
		}
		const metadata = await readSegmentMetadata(canonicalRoot, id);
		const events = await readEvents(canonicalRoot, metadata, MAX_FILE_BYTES);
		const apps = new Set<string>();
		for (const line of events.split("\n")) {
			if (line.length === 0) {
				continue;
			}
			const event: unknown = JSON.parse(line);
			if (isRecord(event) && isRecord(event["app"]) && typeof event["app"]["name"] === "string") {
				apps.add(event["app"]["name"]);
			}
		}
		entries.push({ ...metadata, apps: [...apps].sort() });
	}
	entries.sort((left, right) => right.id.localeCompare(left.id));
	return entries;
}

export async function readHistoryEvidence(root: string, ids: readonly string[]): Promise<string> {
	if (ids.length > MAX_SELECTED_IDS) {
		throw new Error(`Select no more than ${MAX_SELECTED_IDS} history segments.`);
	}
	if (new Set(ids).size !== ids.length || ids.some((id) => !isSegmentId(id))) {
		throw new Error("History segment IDs must be unique UTC dashed timestamps.");
	}
	const canonicalRoot = await checkedRoot(root);
	const outputs: string[] = [];
	let bytesUsed = 0;
	for (const id of [...ids].sort()) {
		const metadata = await readSegmentMetadata(canonicalRoot, id);
		const events = await readEvents(canonicalRoot, metadata, MAX_FILE_BYTES);
		const block = `## ${metadata.id} (${metadata.startedAt} to ${metadata.endedAt})\n${events}`;
		const size = Buffer.byteLength(block, "utf8") + (outputs.length === 0 ? 0 : 1);
		if (bytesUsed + size > MAX_EVIDENCE_BYTES) {
			throw new Error(`Selected history evidence exceeds ${MAX_EVIDENCE_BYTES} UTF-8 bytes.`);
		}
		bytesUsed += size;
		outputs.push(block);
	}
	return outputs.join("\n");
}

export async function saveHistorySkill(skillsDirectory: string, draft: HistoryDraft): Promise<string> {
	const validDraft = historyDraftSchema.parse(draft);
	await ensureRealDirectoryTree(skillsDirectory);
	const canonicalDirectory = await realpath(resolve(skillsDirectory));
	const target = join(canonicalDirectory, validDraft.name);
	assertContained(canonicalDirectory, target);
	const content = `---\nname: ${JSON.stringify(validDraft.name)}\ndescription: ${JSON.stringify(validDraft.description)}\n---\n\n${validDraft.body}\n`;
	try {
		await mkdir(target, { mode: 0o700 });
	} catch (error) {
		if (isNodeError(error, "EEXIST")) {
			throw new Error(`Skill already exists: ${target}`);
		}
		throw error;
	}
	let createdSkillFile = false;
	try {
		const file = await open(join(target, "SKILL.md"), "wx", 0o600);
		createdSkillFile = true;
		try {
			await file.writeFile(content, "utf8");
		} finally {
			await file.close();
		}
	} catch (error) {
		const skillFile = join(target, "SKILL.md");
		if (createdSkillFile) {
			try {
				await unlink(skillFile);
			} catch (cleanupError) {
				if (!isNodeError(cleanupError, "ENOENT")) {
					throw cleanupError;
				}
			}
		}
		try {
			await rmdir(target);
		} catch (cleanupError) {
			if (!isNodeError(cleanupError, "ENOENT") && !isNodeError(cleanupError, "ENOTEMPTY")) {
				throw cleanupError;
			}
		}
		throw new Error(`Could not save history skill at "${target}": ${String(error)}`);
	}
	return join(target, "SKILL.md");
}
