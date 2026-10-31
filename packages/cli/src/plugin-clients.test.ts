import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CLAUDE_ALLOW_RULE,
	CODEX_APPROVAL_TABLE,
	type CliRunner,
	type PluginTarget,
	allowClaudeTools,
	approveCodexTools,
	planClaudeInstall,
	planClaudeRemove,
	planCodexInstall,
	planCodexRemove,
	readClaudeState,
	readCodexState,
	removeClaudeAllow,
	removeCodexApproval,
	runSteps,
} from "./plugin-clients.js";

let home = "";
let checkout = "";
let target: PluginTarget;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "apple-cua-plugin-clients-"));
	checkout = join(home, "apple-cua");
	mkdirSync(join(checkout, "packages/mcp/dist"), { recursive: true });
	writeFileSync(join(checkout, "packages/mcp/dist/server.js"), "");
	target = { bundleDir: join(home, ".apple-cua/bundle"), version: "0.1.0+codex.aaaaaaaaaaaa", checkout };
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function write(path: string, text: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
}

const ours = () => ({
	command: join(checkout, "packages/mcp/dist/apple-cua-mcp"),
	args: [join(checkout, "packages/mcp/dist/server.js")],
	env: {},
});
const foreign = () => {
	const other = join(home, "other-install/server.js");
	write(other, "");
	return { command: "/usr/bin/true", args: [other], env: {} };
};
const steps = (plan: { steps: readonly { describe: string }[] }) => plan.steps.map((step) => step.describe);

describe("#given a fresh Codex #when apple-cua is installed #then CODEX_HOME, the marketplace and the plugin are created", () => {
	it("plans every step, in order, and calls the result added", () => {
		const env = { CODEX_HOME: join(home, "profiles/work") };
		const plan = planCodexInstall(readCodexState(home, env, undefined), target);

		expect(plan.outcome).toBe("added");
		expect(plan.steps.map((step) => step.kind)).toEqual(["mkdir", "run", "run", "edit"]);
		expect(plan.steps[1]).toMatchObject({ args: ["plugin", "marketplace", "add", target.bundleDir] });
		expect(plan.steps[2]).toMatchObject({ args: ["plugin", "add", "apple-cua@apple-cua-local"] });
	});
});

describe("#given Codex already at the target #when apple-cua is installed again #then nothing runs", () => {
	it("reads the marketplace, the plugin and the cached version from Codex's own files", () => {
		write(
			join(home, ".codex/config.toml"),
			`model = "x"\n\n[marketplaces.apple-cua-local]\nsource_type = "local"\nsource = "${target.bundleDir}"\n\n[plugins."apple-cua@apple-cua-local"]\nenabled = true\n\n${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = "approve"\n`,
		);
		mkdirSync(join(home, ".codex/plugins/cache/apple-cua-local/apple-cua", target.version), { recursive: true });

		expect(planCodexInstall(readCodexState(home, {}, undefined), target)).toEqual({
			steps: [],
			outcome: "unchanged",
		});
	});

	it("re-adds the plugin after a settings change gave the bundle a new version", () => {
		write(
			join(home, ".codex/config.toml"),
			`[marketplaces.apple-cua-local]\nsource = "${target.bundleDir}"\n\n[plugins."apple-cua@apple-cua-local"]\nenabled = true\n`,
		);
		mkdirSync(join(home, ".codex/plugins/cache/apple-cua-local/apple-cua/0.1.0+codex.old"), { recursive: true });

		const plan = planCodexInstall(readCodexState(home, {}, undefined), target);

		expect(plan.outcome).toBe("updated");
		expect(steps(plan)).toEqual([
			`installed the apple-cua plugin ${target.version}`,
			'let the apple-cua tools run without asking (default_tools_approval_mode = "approve")',
		]);
	});
});

describe("#given a client that records the bundle path with symlinks resolved #when apple-cua is installed again #then nothing runs", () => {
	it("treats /tmp and /private/tmp (or a symlinked home) as the same marketplace source", () => {
		mkdirSync(target.bundleDir, { recursive: true });
		const resolved = realpathSync(target.bundleDir);
		write(
			join(home, ".codex/config.toml"),
			`[marketplaces.apple-cua-local]\nsource = "${resolved}"\n\n[plugins."apple-cua@apple-cua-local"]\nenabled = true\n\n${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = "approve"\n`,
		);
		mkdirSync(join(home, ".codex/plugins/cache/apple-cua-local/apple-cua", target.version), { recursive: true });
		const linkedHome = join(tmpdir(), `apple-cua-linked-${process.pid}`);
		rmSync(linkedHome, { force: true });
		symlinkSync(home, linkedHome);
		try {
			const viaLink = { ...target, bundleDir: join(linkedHome, ".apple-cua/bundle") };
			expect(planCodexInstall(readCodexState(home, {}, undefined), viaLink).outcome).toBe("unchanged");
		} finally {
			rmSync(linkedHome, { force: true });
		}
	});
});

describe("#given an older hand-written apple-cua entry #when a plugin client is installed #then it is migrated, unless another installation owns it", () => {
	it("removes this checkout's (or a dead) entry first, for Codex and Claude Code", () => {
		const codex = planCodexInstall(readCodexState(home, {}, ours()), target);
		const claude = planClaudeInstall(readClaudeState(home, {}, ours()), target, false);

		expect(codex.steps[0]?.kind).toBe("remove-legacy");
		expect(claude.steps[0]?.kind).toBe("remove-legacy");
	});

	it("leaves another live installation's entry alone and says how to resolve it", () => {
		const codex = planCodexInstall(readCodexState(home, {}, foreign()), target);
		const claude = planClaudeInstall(readClaudeState(home, {}, foreign()), target, false);

		expect(codex.steps).toEqual([]);
		expect(codex.blocked).toContain("codex mcp remove apple-cua");
		expect(claude.blocked).toContain("claude mcp remove apple-cua --scope user");
	});
});

describe("#given Claude Code #when apple-cua is installed or updated #then its own bookkeeping decides the steps", () => {
	it("adds the marketplace and installs at user scope the first time", () => {
		const plan = planClaudeInstall(
			readClaudeState(home, { CLAUDE_CONFIG_DIR: join(home, "cc") }, undefined),
			target,
			false,
		);

		expect(plan.outcome).toBe("added");
		expect(plan.steps.map((step) => (step.kind === "run" ? step.args.join(" ") : step.kind))).toEqual([
			`plugin marketplace add ${target.bundleDir}`,
			"plugin install apple-cua@apple-cua-local --scope user -y",
			"edit",
		]);
	});

	it("refreshes the marketplace and updates the plugin after a settings change, and respects a person's disable", () => {
		write(
			join(home, ".claude/settings.json"),
			JSON.stringify({
				extraKnownMarketplaces: { "apple-cua-local": { source: { source: "directory", path: target.bundleDir } } },
				enabledPlugins: { "apple-cua@apple-cua-local": false },
			}),
		);
		write(
			join(home, ".claude/plugins/installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: { "apple-cua@apple-cua-local": [{ scope: "user", version: "0.1.0+codex.old" }] },
			}),
		);
		const state = readClaudeState(home, {}, undefined);

		const refresh = planClaudeInstall(state, target, false);
		const explicit = planClaudeInstall(state, target, true);

		expect(refresh.outcome).toBe("updated");
		expect(steps(refresh)).toEqual([
			"refreshed the apple-cua-local marketplace",
			`updated the apple-cua plugin 0.1.0+codex.old -> ${target.version}`,
			`let the apple-cua tools run without asking (allow ${CLAUDE_ALLOW_RULE})`,
		]);
		expect(steps(explicit)).toContain("enabled the apple-cua plugin");
	});
});

describe("#given an installed plugin client #when apple-cua is removed #then the plugin, marketplace, our legacy entry and caches go", () => {
	it("plans removal for both clients and nothing when nothing is there", () => {
		write(
			join(home, ".codex/config.toml"),
			`[marketplaces.apple-cua-local]\nsource = "/b"\n\n[plugins."apple-cua@apple-cua-local"]\nenabled = true\n`,
		);
		mkdirSync(join(home, ".codex/plugins/cache/apple-cua-local/apple-cua/v1"), { recursive: true });
		write(
			join(home, ".claude/settings.json"),
			JSON.stringify({ extraKnownMarketplaces: { "apple-cua-local": { source: { path: "/b" } } } }),
		);

		expect(steps(planCodexRemove(readCodexState(home, {}, ours()), checkout))).toEqual([
			"removed the apple-cua plugin",
			"removed the apple-cua-local marketplace",
			"removed the older [mcp_servers.apple-cua] entry",
			`deleted Codex's cached copies (${join(home, ".codex/plugins/cache/apple-cua-local")})`,
		]);
		expect(planClaudeRemove(readClaudeState(home, {}, undefined), checkout).steps.map((step) => step.kind)).toEqual([
			"run",
		]);
		rmSync(join(home, ".codex"), { recursive: true });
		expect(planCodexRemove(readCodexState(home, {}, undefined), checkout).outcome).toBe("absent");
	});
});

describe("#given the per-tool approval prompts of Codex and Claude Code #when apple-cua is installed and removed #then one setting covers every tool", () => {
	it("adds the Codex approval table once, keeps the rest of config.toml, and removes only that table", () => {
		const original = `model = "x"\n\n[plugins."apple-cua@apple-cua-local"]\nenabled = true\n`;
		const approved = approveCodexTools(original);

		expect(approved).toBe(`${original}\n${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = "approve"\n`);
		write(join(home, ".codex/config.toml"), approved);
		expect(readCodexState(home, {}, undefined).toolsApproval).toBe("approve");
		expect(removeCodexApproval(approved)).toBe(original);
		expect(removeCodexApproval(`${approved}\n[tui]\nx = 1\n`)).toBe(`${original}\n[tui]\nx = 1\n`);
		expect(approveCodexTools(`${CODEX_APPROVAL_TABLE}\nother = 1\n`)).toBe(
			`${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = "approve"\nother = 1\n`,
		);
		const withOther = `${original}\n${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = "approve"\nother = 1\n`;
		expect(removeCodexApproval(withOther)).toBe(`${original}\n${CODEX_APPROVAL_TABLE}\nother = 1\n`);
	});

	it.each([
		['"prompt"', "prompt"],
		["'prompt'", "prompt"],
		["'approve'", "approve"],
	])("reads a Codex mode written as %s and never adds a second key", (written, mode) => {
		write(
			join(home, ".codex/config.toml"),
			`[marketplaces.apple-cua-local]\nsource = "${target.bundleDir}"\n\n[plugins."apple-cua@apple-cua-local"]\nenabled = true\n\n${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = ${written}\n`,
		);
		mkdirSync(join(home, ".codex/plugins/cache/apple-cua-local/apple-cua", target.version), { recursive: true });
		const state = readCodexState(home, {}, undefined);

		expect(state.toolsApproval).toBe(mode);
		expect(planCodexInstall(state, target).outcome).toBe("unchanged");
	});

	it("keeps a mode the person chose in Codex when apple-cua is uninstalled", () => {
		const prompt = `[plugins."apple-cua@apple-cua-local"]\nenabled = true\n\n${CODEX_APPROVAL_TABLE}\ndefault_tools_approval_mode = "prompt"\n`;
		write(join(home, ".codex/config.toml"), prompt);

		expect(steps(planCodexRemove(readCodexState(home, {}, undefined), checkout))).not.toContain(
			"removed the apple-cua tool approval setting",
		);
		expect(removeCodexApproval(prompt)).toBe(prompt);
	});

	it("adds the Claude Code allow rule once, keeps other settings, and never overrides an ask or deny rule", () => {
		const original = JSON.stringify({ model: "x", permissions: { allow: ["Read"] } });
		const allowed = allowClaudeTools(original);

		expect(JSON.parse(allowed)).toEqual({ model: "x", permissions: { allow: ["Read", CLAUDE_ALLOW_RULE] } });
		expect(allowClaudeTools(allowed)).toBe(allowed);
		expect(JSON.parse(removeClaudeAllow(allowed))).toEqual(JSON.parse(original));
		expect(JSON.parse(allowClaudeTools(""))).toEqual({ permissions: { allow: [CLAUDE_ALLOW_RULE] } });
		expect(() => allowClaudeTools("[1]")).toThrow(/not a JSON object/);
	});

	it.each(["ask", "deny"] as const)("never overrides a Claude Code %s rule for the server's tools", (list) => {
		write(
			join(home, ".claude/settings.json"),
			JSON.stringify({ permissions: { [list]: [`${CLAUDE_ALLOW_RULE}__click`] } }),
		);
		const state = readClaudeState(home, {}, undefined);

		expect(state.toolsRule).toBe(list);
		expect(planClaudeInstall(state, target, false).steps.some((step) => step.kind === "edit")).toBe(false);
		expect(planClaudeRemove(state, checkout).steps.some((step) => step.kind === "edit")).toBe(false);
	});

	it("plans no edit of a Claude Code settings.json it cannot parse", () => {
		write(join(home, ".claude/settings.json"), "{ not json");
		const state = readClaudeState(home, {}, undefined);

		expect(state.settingsReadable).toBe(false);
		expect(planClaudeInstall(state, target, false).steps.some((step) => step.kind === "edit")).toBe(false);
	});

	it("writes the Claude Code rule when the plan runs, after the CLI steps, with a backup of the old file", () => {
		const settings = join(home, ".claude/settings.json");
		write(settings, JSON.stringify({ theme: "dark" }));
		const plan = planClaudeInstall(readClaudeState(home, {}, undefined), target, false);
		const seenByCli: string[] = [];
		const run: CliRunner = () => {
			seenByCli.push(readFileSync(settings, "utf8"));
			return { status: 0, stdout: "", stderr: "" };
		};

		runSteps(plan, { cli: "claude", env: {}, run, removeLegacy: () => {} });

		expect(seenByCli).toHaveLength(2);
		expect(seenByCli.every((text) => !text.includes(CLAUDE_ALLOW_RULE))).toBe(true);
		const backups = readdirSync(join(home, ".claude")).filter((name) => name.startsWith("settings.json.bak-"));
		expect(backups).toHaveLength(1);
		expect(JSON.parse(readFileSync(join(home, ".claude", backups[0] ?? ""), "utf8"))).toEqual({ theme: "dark" });
		expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
			theme: "dark",
			permissions: { allow: [CLAUDE_ALLOW_RULE] },
		});
		expect(readClaudeState(home, {}, undefined).toolsRule).toBe("allow");
		expect(steps(planClaudeRemove(readClaudeState(home, {}, undefined), checkout))).toContain(
			`removed the ${CLAUDE_ALLOW_RULE} permission rule`,
		);
	});
});

describe("#given a plan #when it runs #then a failing command stops it and the error says what already happened", () => {
	it("runs each step through the client's CLI and reports the failure with context", () => {
		const calls: string[] = [];
		const run: CliRunner = (_cli, args) => {
			calls.push(args.join(" "));
			return args.includes("marketplace")
				? { status: 1, stdout: "", stderr: "boom: marketplace unreadable" }
				: { status: 0, stdout: "", stderr: "" };
		};
		const plan = planCodexInstall(readCodexState(home, {}, undefined), target);

		expect(() => runSteps(plan, { cli: "codex", env: {}, run, removeLegacy: () => {} })).toThrow(
			/codex plugin marketplace add .* failed \(exit 1\): boom: marketplace unreadable; already done: created/,
		);
		expect(calls).toEqual([`plugin marketplace add ${target.bundleDir}`]);
	});
});
