import { describe, expect, it } from "bun:test";
import { resolveSkillDir } from "./capability-tools.js";

describe("resolveSkillDir", () => {
	it("#given a packaged skill #when resolving #then the package-local directory wins", () => {
		const dir = resolveSkillDir(
			"/pkg/skills/opencua",
			"/repo/skills/opencua",
			(path) => path === "/pkg/skills/opencua/SKILL.md",
		);
		expect(dir).toBe("/pkg/skills/opencua");
	});

	it("#given no packaged skill #when resolving #then the checkout directory is used", () => {
		const dir = resolveSkillDir("/pkg/skills/opencua", "/repo/skills/opencua", () => false);
		expect(dir).toBe("/repo/skills/opencua");
	});
});
