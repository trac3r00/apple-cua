import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type BundleInputs,
	MARKETPLACE_NAME,
	SKILL_DIRECTORY,
	bundleMatches,
	planBundle,
	readBundleStamp,
	readSkillFiles,
	writeBundle,
} from "./bundle.js";

let root = "";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "apple-cua-bundle-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function inputs(overrides: Partial<BundleInputs> = {}): BundleInputs {
	return {
		checkout: "/repo",
		baseVersion: "0.1.0",
		launch: { command: "/repo/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp", args: ["/repo/server.js"] },
		env: { APPLE_CUA_DELIVERY: "background", APPLE_CUA_TOOLSET: "full" },
		skill: [
			{ path: "SKILL.md", content: "---\nname: apple-cua\ndescription: drive the Mac\n---\n" },
			{ path: "references/usage.md", content: "# Usage\n" },
		],
		...overrides,
	};
}

function file(plan: ReturnType<typeof planBundle>, path: string): unknown {
	const found = plan.files.find((entry) => entry.path === path);
	if (found === undefined) {
		throw new Error(`${path} is not in the bundle`);
	}
	return path.endsWith(".json") ? JSON.parse(found.content) : found.content;
}

describe("#given the same inputs #when the bundle is planned twice #then the plan and version are identical", () => {
	it("is deterministic, so re-running setup changes nothing", () => {
		expect(planBundle(inputs())).toEqual(planBundle(inputs()));
		expect(planBundle(inputs()).version).toMatch(/^0\.1\.0\+codex\.[0-9a-f]{12}$/);
	});
});

describe("#given a changed setting, skill or checkout #when the bundle is planned #then the version changes", () => {
	it("gives every content change a new version that clients will pick up", () => {
		const base = planBundle(inputs()).version;

		expect(planBundle(inputs({ env: { APPLE_CUA_TOOLSET: "lean" } })).version).not.toBe(base);
		expect(planBundle(inputs({ skill: [{ path: "SKILL.md", content: "changed" }] })).version).not.toBe(base);
		expect(planBundle(inputs({ checkout: "/elsewhere" })).version).not.toBe(base);
		expect(planBundle(inputs({ baseVersion: "0.2.0" })).version).toMatch(/^0\.2\.0\+codex\./);
	});
});

describe("#given a plan #when its manifests are read #then Claude Code and Codex find one plugin with the server and skill", () => {
	it("names one marketplace and plugin for both clients, at the same version, with the helper as the MCP command", () => {
		const plan = planBundle(inputs());
		const claudeMarketplace = file(plan, ".claude-plugin/marketplace.json") as {
			name: string;
			plugins: { name: string; source: string; version: string }[];
		};
		const codexMarketplace = file(plan, ".agents/plugins/marketplace.json") as {
			name: string;
			plugins: { name: string; source: { path: string } }[];
		};
		const codexPlugin = file(plan, "plugins/apple-cua/.codex-plugin/plugin.json") as Record<string, unknown>;
		const mcp = file(plan, "plugins/apple-cua/.mcp.json") as {
			mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
		};

		expect(claudeMarketplace.name).toBe(MARKETPLACE_NAME);
		expect(codexMarketplace.name).toBe(MARKETPLACE_NAME);
		expect(claudeMarketplace.plugins[0]).toMatchObject({ name: "apple-cua", source: "./plugins/apple-cua" });
		expect(claudeMarketplace.plugins[0]?.version).toBe(plan.version);
		expect(codexMarketplace.plugins[0]?.source.path).toBe("./plugins/apple-cua");
		expect(codexPlugin).toMatchObject({ version: plan.version, skills: "./skills/", mcpServers: "./.mcp.json" });
		expect(mcp.mcpServers["apple-cua"]).toEqual({
			command: "/repo/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp",
			args: ["/repo/server.js"],
			env: { APPLE_CUA_DELIVERY: "background", APPLE_CUA_TOOLSET: "full" },
		});
		expect(file(plan, "plugins/apple-cua/gemini-extension.json")).toMatchObject({
			name: "apple-cua",
			version: plan.version,
			mcpServers: { "apple-cua": mcp.mcpServers["apple-cua"] },
		});
		expect(file(plan, `${SKILL_DIRECTORY}/SKILL.md`)).toContain("name: apple-cua");
		expect(file(plan, `${SKILL_DIRECTORY}/agents/openai.yaml`)).toContain('value: "apple-cua"');
	});
});

describe("#given a bundle directory #when the bundle is written #then it holds exactly the plan, and rewriting is a no-op", () => {
	it("writes once, leaves an identical bundle alone, and drops files the new plan no longer has", () => {
		const dir = join(root, "bundle");
		const first = planBundle(inputs());

		expect(writeBundle(dir, first)).toEqual({ changed: true, previous: undefined });
		expect(bundleMatches(dir, first)).toBe(true);
		expect(writeBundle(dir, first).changed).toBe(false);
		expect(readBundleStamp(dir)).toEqual({ version: first.version, hash: first.hash, checkout: "/repo" });

		const second = planBundle(inputs({ skill: [{ path: "SKILL.md", content: "---\nname: apple-cua\n---\n" }] }));
		const rewrite = writeBundle(dir, second);

		expect(rewrite.changed).toBe(true);
		expect(rewrite.previous?.version).toBe(first.version);
		expect(existsSync(join(dir, SKILL_DIRECTORY, "references/usage.md"))).toBe(false);
		expect(readdirSync(root)).toEqual(["bundle"]);
	});

	it("rewrites a bundle someone edited by hand", () => {
		const dir = join(root, "bundle");
		const plan = planBundle(inputs());
		writeBundle(dir, plan);
		writeFileSync(join(dir, "plugins/apple-cua/.mcp.json"), "{}\n");

		expect(writeBundle(dir, plan).changed).toBe(true);
		expect(readFileSync(join(dir, "plugins/apple-cua/.mcp.json"), "utf8")).toContain("apple-cua-mcp");
	});
});

describe("#given a skill directory #when its files are read #then dotfiles are skipped and paths are relative", () => {
	it("reads nested files in a stable order", () => {
		const skill = join(root, "skill");
		const write = (path: string, text: string) => {
			const target = join(skill, path);
			mkdirSync(join(target, ".."), { recursive: true });
			writeFileSync(target, text);
		};
		write("SKILL.md", "skill");
		write("references/b.md", "b");
		write("references/a.md", "a");
		write(".DS_Store", "junk");

		expect(readSkillFiles(skill).map((entry) => entry.path)).toEqual([
			"SKILL.md",
			"references/a.md",
			"references/b.md",
		]);
	});
});
