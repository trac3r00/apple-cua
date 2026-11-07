import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";
import {
	type HistorySegmentEvents,
	type HistorySkillDetection,
	type HistorySkillDetectionOptions,
	detectHistorySkillCandidates,
} from "./history-skill-candidates.js";

const SEGMENT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;

export interface HistorySkillDraft {
	readonly name: string;
	readonly description: string;
	readonly body: string;
}

function isNodeError(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

async function readRegularBounded(path: string, maximum: number): Promise<string | undefined> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() || !info.isFile() || info.size > maximum) return undefined;
	} catch (error: unknown) {
		if (isNodeError(error, "ENOENT")) return undefined;
		throw error;
	}
	const handle = await open(path, "r");
	try {
		const bytes = Buffer.alloc(Math.min((await handle.stat()).size, maximum));
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
		return bytes.subarray(0, bytesRead).toString("utf8");
	} finally {
		await handle.close();
	}
}

function parseLines(text: string): unknown[] {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line): unknown => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		});
}

export async function readRecentHistorySegments(
	historyRoot: string,
	options: { readonly maxSegments?: number } = {},
): Promise<HistorySegmentEvents[]> {
	const segmentsDir = join(historyRoot, "segments");
	let names: string[];
	try {
		const info = await lstat(segmentsDir);
		if (info.isSymbolicLink() || !info.isDirectory()) return [];
		names = await readdir(segmentsDir);
	} catch (error: unknown) {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	}
	const recent = names
		.filter((name) => SEGMENT_ID.test(name))
		.sort()
		.reverse()
		.slice(0, Math.max(1, options.maxSegments ?? 36));
	const segments: HistorySegmentEvents[] = [];
	for (const id of recent) {
		const text = await readRegularBounded(join(segmentsDir, id, "events.jsonl"), MAX_SEGMENT_BYTES);
		if (text !== undefined) segments.push({ id, events: parseLines(text) });
	}
	return segments;
}

export async function suggestHistorySkills(
	historyRoot: string,
	options: HistorySkillDetectionOptions & { readonly maxSegments?: number } = {},
): Promise<HistorySkillDetection> {
	return detectHistorySkillCandidates(await readRecentHistorySegments(historyRoot, options), options);
}

export function validateHistorySkillDraft(draft: HistorySkillDraft): HistorySkillDraft {
	if (!SKILL_NAME.test(draft.name)) {
		throw new Error("Skill name must be a lowercase hyphen slug of 1-64 letters or digits.");
	}
	if (draft.description.trim().length === 0 || draft.description.length > 1024) {
		throw new Error("Skill description must be 1-1024 characters.");
	}
	if (draft.body.trim().length === 0 || draft.body.length > 24_000) {
		throw new Error("Skill body must be 1-24000 characters.");
	}
	return draft;
}

async function deepestExisting(path: string): Promise<{ readonly existing: string; readonly missing: string[] }> {
	const missing: string[] = [];
	let current = resolve(path);
	while (current !== parse(current).root) {
		try {
			await lstat(current);
			return { existing: current, missing };
		} catch (error: unknown) {
			if (!isNodeError(error, "ENOENT")) throw error;
			missing.unshift(current.slice(current.lastIndexOf(sep) + 1));
			current = resolve(current, "..");
		}
	}
	return { existing: current, missing };
}

async function ensureRealDirectoryTree(path: string): Promise<string> {
	const { existing, missing } = await deepestExisting(path);
	let current = await realpath(existing);
	if (!(await lstat(current)).isDirectory()) throw new Error(`Not a directory: ${current}`);
	for (const component of missing) {
		current = join(current, component);
		try {
			await mkdir(current, { mode: 0o700 });
		} catch (error: unknown) {
			if (!isNodeError(error, "EEXIST")) throw error;
		}
		const info = await lstat(current);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Not a real directory: ${current}`);
	}
	return current;
}

/** Creates `<skillsDirectory>/<name>/SKILL.md`; never overwrites an existing skill. */
export async function saveHistorySkillDraft(skillsDirectory: string, draft: HistorySkillDraft): Promise<string> {
	const valid = validateHistorySkillDraft(draft);
	const directory = await ensureRealDirectoryTree(skillsDirectory);
	const target = join(directory, valid.name);
	const fromRoot = relative(directory, target);
	if (fromRoot.startsWith("..") || fromRoot.includes(sep)) throw new Error("Skill path escapes its directory.");
	try {
		await mkdir(target, { mode: 0o700 });
	} catch (error: unknown) {
		if (isNodeError(error, "EEXIST")) throw new Error(`Skill already exists: ${target}`);
		throw error;
	}
	const skillFile = join(target, "SKILL.md");
	const content = `---\nname: ${JSON.stringify(valid.name)}\ndescription: ${JSON.stringify(valid.description)}\n---\n\n${valid.body}\n`;
	let created = false;
	try {
		const file = await open(skillFile, "wx", 0o600);
		created = true;
		try {
			await file.writeFile(content, "utf8");
		} finally {
			await file.close();
		}
	} catch (error: unknown) {
		if (created) await unlink(skillFile).catch(() => undefined);
		await rmdir(target).catch(() => undefined);
		throw new Error(`Could not save skill at "${target}": ${String(error)}`);
	}
	return skillFile;
}
