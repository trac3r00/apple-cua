import { randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type HistorySkillDetection, describeHistoryStep } from "@opencua/core";

export const SKILL_SUGGESTIONS_FILE = "skill-suggestions.json";

export interface MenuSuggestion {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
}

export function agentPromptFor(candidate: HistorySkillDetection["candidates"][number]): string {
	return [
		`Create a reusable skill from my OpenCUA history suggestion ${candidate.id} (${candidate.proposedName}).`,
		`I repeated it ${candidate.occurrences} times: ${candidate.steps.map(describeHistoryStep).join(" -> ")}.`,
		"Call cua_history_suggest_skills to load it, draft the SKILL.md with parameters instead of private values, show me the draft, and save it with cua_history_save_skill only after I approve.",
	].join(" ");
}

export function menuSuggestions(detection: HistorySkillDetection): MenuSuggestion[] {
	return detection.candidates.map((candidate) => ({
		id: candidate.id,
		title: `${candidate.apps.join(" + ")}: ${candidate.steps.length} steps, repeated ${candidate.occurrences}x`,
		prompt: agentPromptFor(candidate),
	}));
}

export function formatSuggestions(detection: HistorySkillDetection): string {
	if (detection.candidates.length === 0) {
		return `No repeated workflow found in ${detection.scannedSegments} recent segment(s). Keep recording and repeat a task at least twice.\n`;
	}
	const lines = [`Suggested skills from ${detection.scannedSegments} recent segment(s):`, ""];
	for (const [index, candidate] of detection.candidates.entries()) {
		lines.push(`${index + 1}. ${candidate.proposedName}  (repeated ${candidate.occurrences}x, id ${candidate.id})`);
		for (const step of candidate.steps) lines.push(`     - ${describeHistoryStep(step)}`);
	}
	lines.push("", 'Ask your agent: "Create a skill from OpenCUA history suggestion <number or id>".', "");
	return lines.join("\n");
}

/** Atomically replaces the menu-bar suggestions file (mode 0600) so the recorder never reads a partial write. */
export async function writeMenuSuggestions(historyRoot: string, detection: HistorySkillDetection): Promise<string> {
	const info = await lstat(historyRoot);
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("History root must be a real directory.");
	const target = join(historyRoot, SKILL_SUGGESTIONS_FILE);
	const temporary = join(historyRoot, `.skill-suggestions-${randomUUID()}.tmp`);
	const file = await open(temporary, "wx", 0o600);
	try {
		try {
			await file.writeFile(`${JSON.stringify({ suggestions: menuSuggestions(detection) })}\n`, "utf8");
		} finally {
			await file.close();
		}
		await rename(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
	return target;
}
