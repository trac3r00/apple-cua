import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

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

describe("macos-cua CLI", () => {
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
		];

		// when
		const topLevelHelp = await runCli(["--help"]);
		const permissionsHelp = await runCli(["permissions", "--help"]);
		const windowsHelp = await runCli(["windows", "--help"]);

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
});
