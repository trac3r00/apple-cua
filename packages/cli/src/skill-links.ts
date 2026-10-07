// Links the bundle's skill into the skill folders of clients that read skills from a folder (OmO, Hermes, pi, ...).
// A folder can serve several clients (~/.agents/skills), so the caller passes the union of the folders its registered
// clients need, and removal only ever deletes a link that points into this installation's bundle.

import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	renameSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isInside } from "./layout.js";

export const SKILL_NAME = "apple-cua";

export type SkillLinkAction = "linked" | "unchanged" | "relinked" | "replaced-copy" | "conflict" | "removed" | "absent";

export interface SkillLinkChange {
	readonly directory: string;
	readonly action: SkillLinkAction;
	readonly detail: string;
	readonly backup?: string | undefined;
}

type Existing =
	| { readonly kind: "none" }
	| { readonly kind: "link"; readonly target: string; readonly targetExists: boolean }
	| { readonly kind: "folder"; readonly isAppleCuaSkill: boolean }
	| { readonly kind: "other" };

function inspectEntry(path: string): Existing {
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(path);
	} catch {
		return { kind: "none" };
	}
	if (stat.isSymbolicLink()) {
		const target = resolve(dirname(path), readlinkSync(path));
		return { kind: "link", target, targetExists: existsSync(target) };
	}
	if (stat.isDirectory()) {
		let isAppleCuaSkill = false;
		try {
			isAppleCuaSkill = /^name:\s*["']?apple-cua["']?\s*$/m.test(readFileSync(join(path, "SKILL.md"), "utf8"));
		} catch {
			isAppleCuaSkill = false;
		}
		return { kind: "folder", isAppleCuaSkill };
	}
	return { kind: "other" };
}

function timestamp(now: Date): string {
	return now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

/**
 * Makes `<directory>/apple-cua` a link to `skillSource`. A link whose target is gone (a deleted checkout) is replaced;
 * an older hand-copied apple-cua skill folder is moved aside first; a live link elsewhere (another installation, the
 * person's own fork) and anything else is left alone and reported as a conflict.
 */
export function linkSkill(directory: string, skillSource: string, now: Date): SkillLinkChange {
	const path = join(directory, SKILL_NAME);
	const existing = inspectEntry(path);
	switch (existing.kind) {
		case "none":
			mkdirSync(directory, { recursive: true });
			symlinkSync(skillSource, path);
			return { directory, action: "linked", detail: `linked ${SKILL_NAME} -> ${skillSource}` };
		case "link":
			if (existing.target === skillSource) {
				return { directory, action: "unchanged", detail: "already linked" };
			}
			if (existing.targetExists) {
				const what = inspectEntry(existing.target);
				const kind =
					what.kind === "folder" && what.isAppleCuaSkill
						? "another apple-cua installation's skill"
						: "something that is not this installation's skill";
				return {
					directory,
					action: "conflict",
					detail: `${path} links to ${existing.target}, ${kind}; left it alone (remove the link to use this installation)`,
				};
			}
			unlinkSync(path);
			symlinkSync(skillSource, path);
			return {
				directory,
				action: "relinked",
				detail: `relinked ${SKILL_NAME} (it pointed to ${existing.target}${existing.targetExists ? "" : ", which is gone"})`,
			};
		case "folder": {
			if (!existing.isAppleCuaSkill) {
				return {
					directory,
					action: "conflict",
					detail: `${path} is a folder that is not the apple-cua skill; left it alone`,
				};
			}
			let backup = `${path}.bak-${timestamp(now)}`;
			for (let suffix = 2; existsSync(backup); suffix += 1) {
				backup = `${path}.bak-${timestamp(now)}-${suffix}`;
			}
			renameSync(path, backup);
			symlinkSync(skillSource, path);
			return {
				directory,
				action: "replaced-copy",
				detail: `moved an older copy of the skill to ${backup} and linked the current one`,
				backup,
			};
		}
		case "other":
			return { directory, action: "conflict", detail: `${path} exists and is not a folder; left it alone` };
	}
}

/** Removes `<directory>/apple-cua` only when it is a link into `bundleDir`; anything else stays. */
export function unlinkSkill(directory: string, bundleDir: string): SkillLinkChange {
	const path = join(directory, SKILL_NAME);
	const existing = inspectEntry(path);
	if (existing.kind === "link" && isInside(existing.target, bundleDir)) {
		unlinkSync(path);
		return { directory, action: "removed", detail: `removed the ${SKILL_NAME} skill link` };
	}
	if (existing.kind === "none") {
		return { directory, action: "absent", detail: "no skill link" };
	}
	return { directory, action: "conflict", detail: `${path} is not this installation's link; left it alone` };
}

export function skillLinked(directory: string, skillSource: string): boolean {
	const existing = inspectEntry(join(directory, SKILL_NAME));
	return existing.kind === "link" && existing.target === skillSource && existing.targetExists;
}
