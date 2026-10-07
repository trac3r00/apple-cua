import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	geminiPluginDir,
	isOriginalPi,
	planGeminiInstall,
	planGeminiRemove,
	planHermesInstall,
	planHermesRemove,
	planOpenClawInstall,
	planOpenClawRemove,
	planPiInstall,
	planPiRemove,
	readGeminiState,
	readHermesEntry,
	readHermesState,
	readOpenClawState,
	readPiState,
} from "./agent-clients.js";
import type { DesiredRegistration } from "./clients.js";

let home = "";
let checkout = "";
let bundleDir = "";
let desired: DesiredRegistration;

beforeEach(() => {
	home = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-agent-clients-")));
	checkout = join(home, "apple-cua");
	bundleDir = join(home, ".apple-cua/bundle");
	mkdirSync(join(checkout, "packages/mcp/dist"), { recursive: true });
	writeFileSync(join(checkout, "packages/mcp/dist/server.js"), "");
	mkdirSync(geminiPluginDir(bundleDir), { recursive: true });
	desired = {
		launch: {
			command: join(checkout, "packages/mcp/dist/apple-cua-mcp"),
			args: [join(checkout, "packages/mcp/dist/server.js")],
		},
		env: { APPLE_CUA_TOOLSET: "full", APPLE_CUA_DELIVERY: "background", APPLE_CUA_IPHONE: undefined },
		envSatisfied: (env) => env["APPLE_CUA_TOOLSET"] === "full" && env["APPLE_CUA_DELIVERY"] === "background",
		bundle: { bundleDir, version: "0.1.0+codex.aaaaaaaaaaaa", checkout },
	};
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function write(path: string, text: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
}

const commands = (plan: { steps: readonly { kind: string; args?: readonly string[] }[] }) =>
	plan.steps.map((step) => (step.kind === "run" && step.args !== undefined ? step.args.join(" ") : step.kind));

function foreignEntry(): { command: string; args: string[]; env: Record<string, string> } {
	const other = join(home, "other/server.js");
	write(other, "");
	return { command: "/usr/bin/true", args: [other], env: {} };
}

describe("#given Gemini CLI #when apple-cua is linked #then one extension carries the server and the skill, read in place", () => {
	it("links the bundle's plugin folder with consent, once", () => {
		const fresh = planGeminiInstall(readGeminiState(home), bundleDir, checkout);
		expect(fresh.outcome).toBe("added");
		expect(commands(fresh)).toEqual([`extensions link ${geminiPluginDir(bundleDir)} --consent`]);

		write(
			join(home, ".gemini/extensions/apple-cua/.gemini-extension-install.json"),
			JSON.stringify({ source: geminiPluginDir(bundleDir), type: "link" }),
		);
		expect(planGeminiInstall(readGeminiState(home), bundleDir, checkout)).toEqual({
			steps: [],
			outcome: "unchanged",
		});
	});

	it("relinks an extension that points elsewhere and migrates an older user-scope server, but not another installation's", () => {
		write(
			join(home, ".gemini/extensions/apple-cua/.gemini-extension-install.json"),
			JSON.stringify({ source: "/old/plugin" }),
		);
		write(
			join(home, ".gemini/settings.json"),
			JSON.stringify({
				mcpServers: { "apple-cua": { command: desired.launch.command, args: desired.launch.args } },
			}),
		);

		expect(commands(planGeminiInstall(readGeminiState(home), bundleDir, checkout))).toEqual([
			"mcp remove -s user apple-cua",
			"extensions uninstall apple-cua",
			`extensions link ${geminiPluginDir(bundleDir)} --consent`,
		]);

		write(join(home, ".gemini/settings.json"), JSON.stringify({ mcpServers: { "apple-cua": foreignEntry() } }));
		expect(planGeminiInstall(readGeminiState(home), bundleDir, checkout).blocked).toContain(
			"gemini mcp remove -s user apple-cua",
		);
		expect(commands(planGeminiRemove(readGeminiState(home), checkout))).toEqual(["extensions uninstall apple-cua"]);
	});
});

describe("#given Hermes' config.yaml #when the apple-cua entry is read #then the block hermes mcp add writes is understood", () => {
	it("reads command, args and env, and ignores the other servers", () => {
		const yaml = [
			"model: x",
			"mcp_servers:",
			"  other:",
			"    command: other",
			"  apple-cua:",
			"    command: /a/apple-cua-mcp",
			"    args:",
			"      - /a/server.js",
			"    env:",
			"      APPLE_CUA_TOOLSET: full",
			"      APPLE_CUA_DELIVERY: 'background'",
			"    enabled: true",
			"skills:",
			"  external_dirs: []",
			"",
		].join("\n");

		expect(readHermesEntry(yaml)).toEqual({
			command: "/a/apple-cua-mcp",
			args: ["/a/server.js"],
			env: { APPLE_CUA_TOOLSET: "full", APPLE_CUA_DELIVERY: "background" },
		});
		expect(readHermesEntry("mcp_servers:\n  other:\n    command: x\n")).toBeUndefined();
		expect(readHermesEntry("model: x\n")).toBeUndefined();
	});
});

describe("#given Hermes #when apple-cua is set up or changed #then the entry is added with Y on stdin, or replaced", () => {
	it("adds with --args last, replaces a changed entry, and leaves a current one alone", () => {
		const fresh = planHermesInstall(readHermesState(home, {}), desired, checkout);
		expect(fresh.outcome).toBe("added");
		expect(fresh.steps[0]).toMatchObject({
			args: [
				"mcp",
				"add",
				"apple-cua",
				"--command",
				desired.launch.command,
				"--env",
				"APPLE_CUA_TOOLSET=full",
				"APPLE_CUA_DELIVERY=background",
				"--args",
				...desired.launch.args,
			],
			input: "Y\n",
		});

		const hermesHome = join(home, "profiles/hermes");
		const block = (toolset: string) =>
			`mcp_servers:\n  apple-cua:\n    command: ${desired.launch.command}\n    args:\n      - ${desired.launch.args[0]}\n    env:\n      APPLE_CUA_TOOLSET: ${toolset}\n      APPLE_CUA_DELIVERY: background\n`;
		write(join(hermesHome, "config.yaml"), block("lean"));
		expect(
			commands(planHermesInstall(readHermesState(home, { HERMES_HOME: hermesHome }), desired, checkout))[0],
		).toBe("mcp remove apple-cua");
		write(join(hermesHome, "config.yaml"), block("full"));
		const state = readHermesState(home, { HERMES_HOME: hermesHome });
		expect(planHermesInstall(state, desired, checkout).outcome).toBe("unchanged");
		expect(planHermesRemove(state, checkout).steps[0]).toMatchObject({
			args: ["mcp", "remove", "apple-cua"],
			input: "Y\n",
		});
	});
});

describe("#given OpenClaw #when apple-cua is set up #then mcp set writes the server and mcp reload hands it to agents", () => {
	it("sets and reloads, skips a current entry, and leaves another installation's alone", () => {
		const plan = planOpenClawInstall(readOpenClawState(home, {}), desired, checkout);
		expect(commands(plan)[0]).toMatch(/^mcp set apple-cua \{"command":/);
		expect(commands(plan)[1]).toBe("mcp reload");

		const stateDir = join(home, "oc");
		const server = {
			command: desired.launch.command,
			args: desired.launch.args,
			env: { APPLE_CUA_TOOLSET: "full", APPLE_CUA_DELIVERY: "background" },
		};
		write(join(stateDir, "openclaw.json"), JSON.stringify({ mcp: { servers: { "apple-cua": server } } }));
		const current = readOpenClawState(home, { OPENCLAW_STATE_DIR: stateDir });
		expect(planOpenClawInstall(current, desired, checkout).outcome).toBe("unchanged");
		expect(commands(planOpenClawRemove(current, checkout))).toEqual(["mcp unset apple-cua", "mcp reload"]);

		write(join(stateDir, "openclaw.json"), JSON.stringify({ mcp: { servers: { "apple-cua": foreignEntry() } } }));
		expect(
			planOpenClawInstall(readOpenClawState(home, { OPENCLAW_STATE_DIR: stateDir }), desired, checkout).blocked,
		).toContain("openclaw mcp unset apple-cua");
	});

	it("names the manual step instead of running mcp unset when OpenClaw's size guard would refuse the write", () => {
		const stateDir = join(home, "oc-small");
		const server = { command: desired.launch.command, args: desired.launch.args, env: { PAD: "x".repeat(600) } };
		write(join(stateDir, "openclaw.json"), JSON.stringify({ mcp: { servers: { "apple-cua": server } } }, null, 2));
		const small = planOpenClawRemove(readOpenClawState(home, { OPENCLAW_STATE_DIR: stateDir }), checkout);
		expect(small.steps).toEqual([]);
		expect(small.blocked).toContain("delete mcp.servers.apple-cua");

		const others = Object.fromEntries(
			["a", "b", "c"].map((name) => [name, { command: "npx", args: ["x".repeat(400)] }]),
		);
		write(
			join(stateDir, "openclaw.json"),
			JSON.stringify({ mcp: { servers: { "apple-cua": server, ...others } } }, null, 2),
		);
		const roomy = planOpenClawRemove(readOpenClawState(home, { OPENCLAW_STATE_DIR: stateDir }), checkout);
		expect(commands(roomy)).toEqual(["mcp unset apple-cua", "mcp reload"]);
	});
});

describe("#given the original pi #when the apple-cua package is installed #then pi's own settings decide", () => {
	it("installs once, reads the relative paths pi stores, and removes it again", () => {
		expect(commands(planPiInstall(readPiState(home, {}), checkout))).toEqual([
			`install ${join(checkout, "packages/pi-extension")}`,
		]);

		const agentDir = join(home, "pi-agent");
		write(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: ["../apple-cua/packages/pi-extension", "npm:other"] }),
		);
		const state = readPiState(home, { PI_CODING_AGENT_DIR: agentDir });
		expect(planPiInstall(state, checkout).outcome).toBe("unchanged");
		expect(commands(planPiRemove(state, checkout))).toEqual([`remove ${join(checkout, "packages/pi-extension")}`]);
	});

	it("tells the original pi from senpi by the package its binary lives in", () => {
		const original = join(home, "node_modules/@mariozechner/pi-coding-agent/dist/cli.js");
		const senpi = join(home, "node_modules/@code-yeongyu/senpi/dist/cli.js");
		write(original, "");
		write(senpi, "");
		symlinkSync(original, join(home, "pi-original"));
		symlinkSync(senpi, join(home, "pi-senpi"));

		expect(isOriginalPi(join(home, "pi-original"))).toBe(true);
		expect(isOriginalPi(join(home, "pi-senpi"))).toBe(false);
	});
});
