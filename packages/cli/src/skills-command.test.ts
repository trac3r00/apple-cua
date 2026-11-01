import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { resolveLayout } from "./layout.js";
import { registerSkillsCommands } from "./skills-command.js";

let root: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "opencua-skills-command-")));
	mkdirSync(join(root, "references"));
	writeFileSync(join(root, "SKILL.md"), "desktop fixture\n");
	writeFileSync(join(root, "references", "macos.md"), "platform fixture\n");
	writeFileSync(join(root, "references", "usage.md"), "usage fixture\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function harness(source = root): { readonly program: Command; readonly output: string[] } {
	const output: string[] = [];
	const program = new Command().exitOverride().configureOutput({ writeErr: () => undefined });
	registerSkillsCommands(program, { skillSource: source, write: (text) => output.push(text) });
	return { program, output };
}

describe("skills command", () => {
	it("#given installed reference topics #when listing skills #then desktop and sorted references are discoverable", async () => {
		const { program, output } = harness();
		await program.parseAsync(["skills", "list"], { from: "user" });
		expect(output).toEqual(["desktop\nmacos\nusage\n"]);
	});

	it.each([
		["desktop", "SKILL.md"],
		["macos", "references/macos.md"],
	])("#given topic %s #when reading its skill #then the installed bytes are printed", async (topic, path) => {
		const { program, output } = harness();
		await program.parseAsync(["skills", "get", topic], { from: "user" });
		expect(output).toEqual([readFileSync(join(root, path), "utf8")]);
	});

	it.each(["unknown", "../SKILL", "/etc/passwd", "..\\SKILL"])(
		"#given invalid topic %s #when getting a skill #then nothing is read or printed",
		async (topic) => {
			const { program, output } = harness();
			await expect(program.parseAsync(["skills", "get", topic], { from: "user" })).rejects.toThrow();
			expect(output).toEqual([]);
		},
	);

	it("#given a desktop symlink escaping the skill root #when reading #then outside content is refused", async () => {
		const source = join(root, "nested");
		mkdirSync(join(source, "references"), { recursive: true });
		symlinkSync(join(root, "SKILL.md"), join(source, "SKILL.md"));
		const { program, output } = harness(source);
		await expect(program.parseAsync(["skills", "get", "desktop"], { from: "user" })).rejects.toThrow();
		expect(output).toEqual([]);
	});

	it("#given the running checkout #when getting desktop #then the shipped skill is returned byte for byte", async () => {
		const source = resolveLayout().skillSource;
		const { program, output } = harness(source);
		await program.parseAsync(["skills", "get", "desktop"], { from: "user" });
		expect(output).toEqual([readFileSync(join(source, "SKILL.md"), "utf8")]);
	});
});
