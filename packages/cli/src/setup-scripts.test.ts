import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "apple-cua-scripts-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function run(script: string, args: readonly string[], env: Readonly<Record<string, string>> = {}) {
	return spawnSync("/bin/bash", [join(repo, script), ...args], {
		encoding: "utf8",
		input: "",
		env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, ...env },
	});
}

describe("#given a Mac older than macOS 15 #when setup or the installer runs #then it refuses before changing anything", () => {
	it.each(["scripts/setup.sh", "install.sh"])("%s refuses macOS 14.7 and says how to update", (script) => {
		const result = run(script, [], { APPLE_CUA_MACOS_VERSION: "14.7" });

		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/supports macOS 15(?:\.0)? \(Sequoia\) and later, and this Mac runs macOS 14\.7/);
		expect(result.stderr).toContain("Software Update");
		expect(readdirSync(home)).toEqual([]);
	});

	it.each(["scripts/setup.sh", "install.sh"])("%s --help prints its usage and exits 0", (script) => {
		const result = run(script, ["--help"]);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/^usage: /);
		expect(result.stdout).toContain("--add-to-path");
	});
});

describe("#given the helper build script #when it is asked for its inputs digest #then it reports the identity inputs only", () => {
	it("is stable, changes with the bundle id, and builds nothing", () => {
		const digest = (bundleId: string) =>
			run("scripts/build-tcc-helper.sh", ["--inputs-digest"], { APPLE_CUA_BUNDLE_ID: bundleId }).stdout.trim();

		expect(digest("dev.applecua.mcp.a")).toMatch(/^[0-9a-f]{64}$/);
		expect(digest("dev.applecua.mcp.a")).toBe(digest("dev.applecua.mcp.a"));
		expect(digest("dev.applecua.mcp.b")).not.toBe(digest("dev.applecua.mcp.a"));
		expect(readdirSync(home)).toEqual([]);
	});
});
