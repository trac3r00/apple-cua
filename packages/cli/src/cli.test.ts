import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { type MirroringSessionState, formatIosStatus } from "./ios.js";

type PackageJson = {
	version: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "../../..");
const cliPath = join(__dirname, "cli.ts");
const packageJson: PackageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as PackageJson;

function runCli(args: string[]) {
	return execa(process.execPath, ["--experimental-strip-types", cliPath, ...args], {
		cwd: workspaceRoot,
		env: { ...process.env, FORCE_COLOR: "0" },
	});
}

function runCliAllowingFailure(args: string[]) {
	return execa(process.execPath, ["--experimental-strip-types", cliPath, ...args], {
		cwd: workspaceRoot,
		env: { ...process.env, FORCE_COLOR: "0" },
		reject: false,
	});
}

// Each test spawns its own CLI process and shares no state, so a describe's tests run concurrently.
describe.concurrent("apple-cua CLI", () => {
	it("#given package metadata #when --version runs #then it prints the package version", async () => {
		// given
		const expectedVersion = packageJson.version;

		// when
		const result = await runCli(["--version"]);

		// then
		expect(result.stdout.trim()).toBe(expectedVersion);
	});

	it("#given the command surface #when help runs #then it lists all subcommands", async () => {
		// given
		const expectedTopLevelCommands = [
			"screenshot",
			"click",
			"right-click",
			"middle-click",
			"double-click",
			"move",
			"drag",
			"scroll",
			"type",
			"key",
			"keypress",
			"wait",
			"cursor",
			"screen",
			"permissions",
			"windows",
			"ios",
			"doctor",
			"config",
			"update",
			"uninstall",
		];

		// when
		const [topLevelHelp, permissionsHelp, windowsHelp] = await Promise.all([
			runCli(["--help"]),
			runCli(["permissions", "--help"]),
			runCli(["windows", "--help"]),
		]);

		// then
		for (const command of expectedTopLevelCommands) {
			expect(topLevelHelp.stdout).toContain(command);
		}
		expect(permissionsHelp.stdout).toContain("check");
		expect(permissionsHelp.stdout).toContain("request");
		expect(windowsHelp.stdout).toContain("active");
		expect(windowsHelp.stdout).toContain("list");
	});

	it("#given screen permissions #when checking status #then it returns an expected status string", async () => {
		// given
		const expectedStatuses = ["authorized", "denied", "not-determined", "restricted", "unknown"];

		// when
		const result = await runCli(["permissions", "check", "screen"]);

		// then
		expect(expectedStatuses).toContain(result.stdout.trim());
	});

	it("#given this checkout in any state #when doctor runs with --json #then it prints one report and exits 0 only when ready", async () => {
		// when
		const result = await runCliAllowingFailure(["doctor", "--json"]);

		// then
		const report = JSON.parse(result.stdout) as { ready: boolean; checks: { id: string; status: string }[] };
		expect(report.checks.map((item) => item.id)).toEqual(
			expect.arrayContaining(["macos", "node", "native:libsckit.dylib", "native:cursor-overlay", "helper"]),
		);
		expect(report.ready).toBe(report.checks.every((item) => item.status !== "fail"));
		expect(result.exitCode).toBe(report.ready ? 0 : 1);
	}, 60_000);

	it("#given an empty home #when config registers omo and approves an app #then config.json and the omo entry are written and --show reports them", async () => {
		const home = mkdtempSync(join(tmpdir(), "apple-cua-cli-config-"));
		try {
			const env = { ...process.env, HOME: home, APPLE_CUA_HOME: join(home, ".apple-cua"), FORCE_COLOR: "0" };
			const run = (args: string[]) =>
				execa(process.execPath, ["--experimental-strip-types", cliPath, ...args], { cwd: workspaceRoot, env });

			const registered = await run([
				"config",
				"--register",
				"omo",
				"--allow",
				"com.apple.TextEdit",
				"--toolset",
				"lean",
			]);
			const shown = await run(["--json", "config", "--show"]);

			const report = JSON.parse(shown.stdout) as {
				saved: boolean;
				settings: { allowedApps: string[]; toolset: string; clients: string[] };
				registrations: { client: string; state: string }[];
			};
			const omo = JSON.parse(readFileSync(join(home, ".omo/agent/mcp.json"), "utf8")) as {
				mcpServers: Record<string, { env: Record<string, string> }>;
			};
			expect(registered.stdout).toContain("added apple-cua");
			expect(report).toMatchObject({
				saved: true,
				settings: { allowedApps: ["com.apple.TextEdit"], toolset: "lean", clients: ["omo"] },
				registrations: [{ client: "omo", state: "current" }],
			});
			expect(omo.mcpServers["apple-cua"]?.env).toMatchObject({
				APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit",
				APPLE_CUA_TOOLSET: "lean",
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	}, 60_000);
});

describe.concurrent("apple-cua CLI iOS commands", () => {
	it("#given the iOS command group #when help runs #then every iPhone command is listed", async () => {
		// given
		const expectedCommands = [
			"status",
			"observe",
			"screenshot",
			"tap",
			"tap-text",
			"long-press",
			"swipe",
			"scroll",
			"type",
			"key",
			"home",
			"app-switcher",
			"open-app",
		];

		// when
		const result = await runCli(["ios", "--help"]);

		// then
		for (const command of expectedCommands) {
			expect(result.stdout).toMatch(new RegExp(`^\\s+${command}(?:[ <]|$)`, "m"));
		}
	});

	it.each([
		["ready", 0, "connected and ready"],
		["blocked", 1, "interstitial"],
		["no-window", 1, "Connect your phone"],
		["not-running", 1, "open the iPhone Mirroring app"],
	] as const)(
		"#given a %s session #when status is formatted #then its exit code and guidance are stable",
		(state: MirroringSessionState, exitCode: 0 | 1, message: string) => {
			// when
			const output = formatIosStatus(state);
			const rendered = output.lines.join("\n");

			// then
			expect(output.exitCode).toBe(exitCode);
			expect(output.lines[0]).toBe(state);
			expect(rendered).toContain("iPhone Mirroring");
			expect(rendered).toContain(message);
			if (state === "blocked") {
				expect(rendered).toMatch(/will not tap Connect/i);
				expect(rendered).not.toMatch(/(?:please|should|must) tap (?:the )?Connect/i);
			}
		},
	);

	it("#given the local Mac #when iOS status runs #then it reports a state or actionable mirroring guidance", async () => {
		// when
		const result = await runCliAllowingFailure(["ios", "status"]);
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

		// then
		expect(output).not.toBe("");
		if (result.exitCode === 0) {
			expect(result.stdout).toMatch(/ready|blocked|no-window|not-running/);
		} else {
			expect(output).toContain("iPhone Mirroring");
		}
	});
});

describe.concurrent("apple-cua CLI screenshot capture options", () => {
	it("#given the screenshot command #when help runs #then region and display selection are documented", async () => {
		// when
		const result = await runCli(["screenshot", "--help"]);

		// then
		expect(result.stdout).toContain("--region");
		expect(result.stdout).toContain("--display");
	});

	it("#given a malformed region #when screenshot runs #then it fails before capturing", async () => {
		// when
		const result = await runCliAllowingFailure(["screenshot", "-o", "/tmp/apple-cua-unused.png", "-r", "1,2,3"]);

		// then
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("region must be x,y,width,height");
	});
});
