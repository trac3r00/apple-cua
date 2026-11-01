import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "opencua-scripts-"));
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
		const result = run(script, [], { OPENCUA_MACOS_VERSION: "14.7" });

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
			run("scripts/build-tcc-helper.sh", ["--inputs-digest"], { OPENCUA_BUNDLE_ID: bundleId }).stdout.trim();

		expect(digest("dev.applecua.mcp.a")).toMatch(/^[0-9a-f]{64}$/);
		expect(digest("dev.applecua.mcp.a")).toBe(digest("dev.applecua.mcp.a"));
		expect(digest("dev.applecua.mcp.b")).not.toBe(digest("dev.applecua.mcp.a"));
		expect(readdirSync(home)).toEqual([]);
	});
});

describe("#given a Linux checkout and legacy state #when setup runs #then it skips Apple tools and installs compatible launchers", () => {
	it.each([false, true])("preserves existing data and a foreign legacy launcher=%s", (foreign) => {
		const bin = join(home, "tools");
		const launchers = join(home, "launchers");
		const state = join(home, ".apple-cua");
		mkdirSync(bin);
		mkdirSync(launchers);
		mkdirSync(state);
		writeFileSync(join(state, "history.json"), "keep");
		const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
		const version = String(manifest.packageManager).split("@")[1];
		const scripts: Record<string, string> = {
			uname: '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else echo aarch64; fi\n',
			pnpm: `#!/bin/sh\nif [ "$1" = "--version" ]; then echo '${version}'; fi\nexit 0\n`,
			node: `#!/bin/sh\nif [ "$1" = '${join(repo, "packages/cli/dist/cli.js")}' ]; then exit 0; fi\nexec '${process.execPath}' "$@"\n`,
			"pkg-config": "#!/bin/sh\nexit 0\n",
			// The dependency check imports AT-SPI and GdkPixbuf through Python GI, and captures with import.
			python3: "#!/bin/sh\nexit 0\n",
			import: "#!/bin/sh\nexit 0\n",
			xdotool: "#!/bin/sh\nexit 0\n",
			grim: "#!/bin/sh\nexit 0\n",
		};
		for (const name of ["sw_vers", "sysctl", "xcode-select", "xcrun", "otool", "lipo", "codesign"]) {
			scripts[name] = "#!/bin/sh\necho 'unexpected macOS tool' >&2\nexit 99\n";
		}
		for (const [name, script] of Object.entries(scripts)) writeFileSync(join(bin, name), script, { mode: 0o755 });
		if (foreign) writeFileSync(join(launchers, "apple-cua"), "foreign executable\n");
		const result = run("scripts/setup.sh", ["--yes", "--no-doctor"], {
			PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
			OPENCUA_BIN_DIR: launchers,
			OPENCUA_BROWSER: "off",
		});
		expect(result.stderr).not.toContain("unexpected macOS tool");
		expect(result.status, result.stderr).toBe(0);
		expect(readFileSync(join(launchers, "opencua"), "utf8")).toContain(state);
		expect(readFileSync(join(launchers, "apple-cua"), "utf8")).toBe(
			foreign ? "foreign executable\n" : readFileSync(join(launchers, "opencua"), "utf8"),
		);
		expect(readFileSync(join(state, "history.json"), "utf8")).toBe("keep");
		expect(readdirSync(home)).not.toContain(".opencua");
	});
});
