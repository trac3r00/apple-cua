import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const setup = join(repo, "scripts/setup.sh");
const cli = join(repo, "packages/cli/src/cli.ts");
/** No node on it, so setup has to ask before it downloads one. */
const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "apple-cua-prompts-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

/**
 * Runs an expect script; the program it spawns gets a terminal, while its stdin can still be redirected. Patterns are
 * not anchored at the end: Node's readline writes a cursor move after its prompt.
 */
function expectScript(body: string, env: Readonly<Record<string, string>>): string {
	const script = join(home, "session.exp");
	writeFileSync(script, `set timeout 60\n${body}\nset result [wait]\nputs "EXIT [lindex $result 3]"\n`);
	const result = spawnSync("/usr/bin/expect", [script], { encoding: "utf8", env: { TERM: "dumb", ...env } });
	return `${result.stdout}${result.stderr}`.replaceAll("\r", "");
}

describe("#given setup under curl | bash, where stdin is the download #when it must ask #then it asks on the terminal", () => {
	it("shows the question on the terminal and reads the answer from it", () => {
		const transcript = expectScript(
			[
				`spawn /bin/bash -c {cat /dev/null | bash ${setup}}`,
				"expect -re {Download the official Node.js LTS[^\\n]*\\[Y/n\\] }",
				'send "n\\r"',
				"expect eof",
			].join("\n"),
			{ HOME: home, PATH: SYSTEM_PATH },
		);

		expect(transcript).toContain("a Node.js download was declined");
		expect(transcript).toContain("EXIT 1");
	});
});

describe("#given no terminal at all, as on CI #when setup must ask #then it takes the default without asking", () => {
	it("goes ahead with the download without a question", async () => {
		const child = spawn("/bin/bash", [setup], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			// The download then fails at once, which proves it was attempted without asking.
			env: { HOME: home, PATH: SYSTEM_PATH, https_proxy: "http://127.0.0.1:9" },
		});
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		const status = await new Promise<number | null>((done) => {
			child.on("close", done);
		});

		expect(status).toBe(1);
		expect(output).not.toContain("[Y/n]");
		expect(output).toContain("cannot reach nodejs.org");
	}, 60_000);
});

describe("#given apple-cua config with stdin from a pipe in a terminal #when it asks #then the questions reach the terminal", () => {
	it("asks on the terminal and saves the answers", () => {
		const transcript = expectScript(
			[
				`spawn /bin/bash -c {${process.execPath} --experimental-strip-types ${cli} config < /dev/null}`,
				"expect -re {Add apps[^\\n]*: }",
				'send "com.apple.TextEdit\\r"',
				"expect -re {Delivery[^\\n]*: }",
				'send "\\r"',
				"expect -re {Toolset[^\\n]*: }",
				'send "lean\\r"',
				"expect -re {iPhone Mirroring tools[^\\n]*: }",
				'send "\\r"',
				"expect -re {Register with[^\\n]*: }",
				'send "\\r"',
				"expect eof",
			].join("\n"),
			{ HOME: home, APPLE_CUA_HOME: join(home, ".apple-cua"), PATH: SYSTEM_PATH },
		);

		expect(transcript).toContain("EXIT 0");
		expect(JSON.parse(readFileSync(join(home, ".apple-cua/config.json"), "utf8"))).toMatchObject({
			allowedApps: ["com.apple.TextEdit"],
			toolset: "lean",
			clients: [],
		});
	});
});
