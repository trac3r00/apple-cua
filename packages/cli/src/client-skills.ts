// Which skill folders each registered client reads, and keeping this installation's links in them in step.
// Plugin clients (Codex, Claude Code) get the skill inside the plugin; a client on a plain MCP entry reads it from a
// folder. One folder can serve several clients, so links are synced for the whole set of registered clients at once.

import { join } from "node:path";
import { hermesHomeOf, openClawStateDirOf } from "./agent-clients.js";
import { SKILL_DIRECTORY } from "./bundle.js";
import { type ClientContext, type ClientName, usesPlugin } from "./clients.js";
import { claudeConfigDirOf } from "./plugin-clients.js";
import { type SkillLinkChange, linkSkill, skillLinked, unlinkSkill } from "./skill-links.js";

export function skillFoldersFor(client: ClientName, context: ClientContext): string[] {
	switch (client) {
		case "omo":
			return [join(context.home, ".agents/skills")];
		case "codex":
			return usesPlugin("codex", context) ? [] : [join(context.home, ".agents/skills")];
		case "claude":
			return usesPlugin("claude", context) ? [] : [join(claudeConfigDirOf(context.home, context.env), "skills")];
		case "cursor":
			return [join(context.home, ".cursor/skills")];
		case "hermes":
			return [join(hermesHomeOf(context.home, context.env), "skills")];
		case "openclaw":
			// OpenClaw follows a symlinked skill in its managed folder, but not in skills.load.extraDirs.
			return [join(openClawStateDirOf(context.home, context.env), "skills")];
		case "gemini":
		case "pi":
		case "json":
			return [];
	}
}

/** Every folder apple-cua may have linked the skill into, for cleanup. */
function knownSkillFolders(context: ClientContext): string[] {
	return [
		join(context.home, ".agents/skills"),
		join(claudeConfigDirOf(context.home, context.env), "skills"),
		join(context.home, ".cursor/skills"),
		join(hermesHomeOf(context.home, context.env), "skills"),
		join(openClawStateDirOf(context.home, context.env), "skills"),
	];
}

/**
 * Links the skill into every folder the registered clients need and removes this installation's links from the folders
 * none of them needs any more. Links that are not this installation's are never touched.
 */
export function syncSkillLinks(
	clients: readonly ClientName[],
	bundleDir: string,
	context: ClientContext,
): SkillLinkChange[] {
	const wanted = [...new Set(clients.flatMap((client) => skillFoldersFor(client, context)))];
	const skillSource = join(bundleDir, SKILL_DIRECTORY);
	const changes = wanted.map((folder) => linkSkill(folder, skillSource, context.now));
	for (const folder of knownSkillFolders(context)) {
		if (!wanted.includes(folder)) {
			const change = unlinkSkill(folder, bundleDir);
			if (change.action === "removed") {
				changes.push(change);
			}
		}
	}
	return changes;
}

/** The first skill folder this client reads that lacks this installation's link, if any. */
export function missingSkillLink(client: ClientName, bundleDir: string, context: ClientContext): string | undefined {
	const skillSource = join(bundleDir, SKILL_DIRECTORY);
	return skillFoldersFor(client, context).find((folder) => !skillLinked(folder, skillSource));
}
