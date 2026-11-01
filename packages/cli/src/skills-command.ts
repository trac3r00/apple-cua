import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { Command } from "commander";
import { resolveLayout } from "./layout.js";

/** Serve the docs from the same checkout as the running CLI, not a user's separately installed skills. */
export function registerSkillsCommands(
	program: Command,
	options: { readonly skillSource?: string; readonly write?: (text: string) => void } = {},
): void {
	const source = options.skillSource ?? resolveLayout().skillSource;
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const topics = (): string[] => [
		"desktop",
		...readdirSync(join(source, "references"), { withFileTypes: true })
			.filter((entry) => entry.isFile() && /^[a-z0-9][a-z0-9-]*\.md$/.test(entry.name))
			.map((entry) => entry.name.slice(0, -3))
			.filter((topic) => topic !== "desktop")
			.sort(),
	];
	const skills = program.command("skills").description("Read version-matched OpenCUA skills from this installation");
	skills
		.command("list")
		.description("List available skill topics")
		.action(() => write(`${topics().join("\n")}\n`));
	skills
		.command("get <topic>")
		.description("Print desktop (SKILL.md) or a listed reference topic")
		.action((topic: string) => {
			if (!topics().includes(topic)) {
				skills.error(`Unknown skill topic ${JSON.stringify(topic)}. Run: opencua skills list`);
			}
			const root = realpathSync(source);
			const file = realpathSync(join(root, topic === "desktop" ? "SKILL.md" : `references/${topic}.md`));
			if (!file.startsWith(`${root}${sep}`))
				skills.error("Skill topic resolves outside the installed skill directory.");
			write(readFileSync(file, "utf8"));
		});
}
