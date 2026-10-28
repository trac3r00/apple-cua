import { describe, expect, it } from "vitest";
import { resolveSkillDir } from "./capability-tools.js";

describe("resolveSkillDir", () => {
	it("#given a packaged skill #when resolving #then the package-local directory wins", () => {
		const dir = resolveSkillDir(
			"/pkg/skills/apple-cua",
			"/repo/skills/apple-cua",
			(path) => path === "/pkg/skills/apple-cua/SKILL.md",
		);
		expect(dir).toBe("/pkg/skills/apple-cua");
	});

	it("#given no packaged skill #when resolving #then the checkout directory is used", () => {
		const dir = resolveSkillDir("/pkg/skills/apple-cua", "/repo/skills/apple-cua", () => false);
		expect(dir).toBe("/repo/skills/apple-cua");
	});
});
