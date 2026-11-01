import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkSkill, skillLinked, unlinkSkill } from "./skill-links.js";

let root = "";
let bundle = "";
let skill = "";
let skills = "";
const now = new Date("2026-10-07T12:00:00Z");

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opencua-skill-links-"));
	bundle = join(root, "bundle");
	skill = join(bundle, "plugins/opencua/skills/opencua");
	skills = join(root, "home/.agents/skills");
	mkdirSync(skill, { recursive: true });
	writeFileSync(join(skill, "SKILL.md"), "---\nname: opencua\n---\n");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("#given no skill there yet #when the skill is linked #then a link to the bundle is created, once", () => {
	it("creates the folder and the link, and a second run changes nothing", () => {
		expect(linkSkill(skills, skill, now).action).toBe("linked");
		expect(readlinkSync(join(skills, "opencua"))).toBe(skill);
		expect(skillLinked(skills, skill)).toBe(true);
		expect(linkSkill(skills, skill, now).action).toBe("unchanged");
	});
});

describe("#given an older opencua install #when the skill is linked #then it is replaced, keeping a hand copy as a backup", () => {
	it("replaces an installed apple-cua directory without deleting its contents", () => {
		mkdirSync(join(skills, "apple-cua"), { recursive: true });
		writeFileSync(join(skills, "apple-cua/SKILL.md"), "---\nname: apple-cua\n---\n");
		const change = linkSkill(skills, skill, now);
		expect(change.action).toBe("replaced-copy");
		expect(existsSync(join(skills, "apple-cua"))).toBe(false);
		expect(readFileSync(join(change.backup ?? "", "SKILL.md"), "utf8")).toContain("name: apple-cua");
		expect(skillLinked(skills, skill)).toBe(true);
	});
	it("recognizes the legacy apple-cua frontmatter as a replaceable copy", () => {
		mkdirSync(join(skills, "opencua"), { recursive: true });
		writeFileSync(join(skills, "opencua/SKILL.md"), "---\nname: apple-cua\n---\n");
		const change = linkSkill(skills, skill, now);
		expect(change.action).toBe("replaced-copy");
		expect(readFileSync(join(change.backup ?? "", "SKILL.md"), "utf8")).toContain("name: apple-cua");
		expect(skillLinked(skills, skill)).toBe(true);
	});
	it("relinks a link to a checkout that is gone", () => {
		mkdirSync(skills, { recursive: true });
		symlinkSync(join(root, "old-opencua/skills/opencua"), join(skills, "opencua"));

		const change = linkSkill(skills, skill, now);

		expect(change.action).toBe("relinked");
		expect(change.detail).toContain("which is gone");
		expect(readlinkSync(join(skills, "opencua"))).toBe(skill);
	});

	it("moves a hand-copied opencua skill aside before linking", () => {
		mkdirSync(join(skills, "opencua"), { recursive: true });
		writeFileSync(join(skills, "opencua/SKILL.md"), "---\nname: opencua\ndescription: old\n---\n");

		const change = linkSkill(skills, skill, now);

		expect(change.action).toBe("replaced-copy");
		expect(change.backup).toBe(join(skills, "opencua.bak-20261007-120000"));
		expect(readFileSync(join(change.backup ?? "", "SKILL.md"), "utf8")).toContain("description: old");
		expect(lstatSync(join(skills, "opencua")).isSymbolicLink()).toBe(true);
	});
});

describe("#given something that is not opencua's #when the skill is linked or unlinked #then it is left alone", () => {
	it("reports a conflict for an unrelated folder or a live link elsewhere, and never deletes them", () => {
		mkdirSync(join(skills, "opencua"), { recursive: true });
		writeFileSync(join(skills, "opencua/SKILL.md"), "---\nname: someone-else\n---\n");
		expect(linkSkill(skills, skill, now).action).toBe("conflict");
		expect(unlinkSkill(skills, bundle).action).toBe("conflict");
		expect(existsSync(join(skills, "opencua/SKILL.md"))).toBe(true);

		rmSync(join(skills, "opencua"), { recursive: true });
		const elsewhere = join(root, "my-skills/custom");
		mkdirSync(elsewhere, { recursive: true });
		symlinkSync(elsewhere, join(skills, "opencua"));
		expect(linkSkill(skills, skill, now).action).toBe("conflict");
		expect(readlinkSync(join(skills, "opencua"))).toBe(elsewhere);
	});
});

describe("#given this installation's link #when the skill is unlinked #then only that link is removed", () => {
	it("removes the link, leaves the bundle, and reports absent afterwards", () => {
		linkSkill(skills, skill, now);

		expect(unlinkSkill(skills, bundle).action).toBe("removed");
		expect(existsSync(join(skills, "opencua"))).toBe(false);
		expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
		expect(unlinkSkill(skills, bundle).action).toBe("absent");
	});
});
