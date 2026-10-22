import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkScope, checkSources, exitCode, isScopeFile, parseArgs, run, sha256 } from "./preflight.mjs";

const GATE = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
const scratch = [];

function fixture(files) {
	const root = mkdtempSync(join(tmpdir(), "apple-cua-preflight-"));
	scratch.push(root);
	for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
	return root;
}

afterEach(() => {
	for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("preflight arguments", () => {
	it("#given an unknown argument #when parsed #then it is refused", () => {
		assert.throws(() => parseArgs(["--force"]), /unknown argument/);
	});
	it("#given --only with an unmapped id #when parsed #then it is refused", () => {
		assert.throws(() => parseArgs(["--only", "EXP-999"]), /unknown check id/);
	});
	it("#given --only with mapped ids #when parsed #then they are selected", () => {
		assert.deepEqual(parseArgs(["--only", "EXP-001,EXP-010"]).only, ["EXP-001", "EXP-010"]);
	});
});

describe("preflight exit status", () => {
	it("#given every obligation passed #when summarized #then exit is 0", () => {
		assert.equal(exitCode([{ status: "PASS" }, { status: "PASS" }]), 0);
	});
	it("#given no obligation ran #when summarized #then coverage is incomplete, not a pass", () => {
		assert.equal(exitCode([]), 2);
	});
	it("#given a blocked obligation #when summarized #then exit is 2", () => {
		assert.equal(exitCode([{ status: "PASS" }, { status: "BLOCKED" }]), 2);
	});
	it("#given a failure and a block #when summarized #then the failure wins", () => {
		assert.equal(exitCode([{ status: "BLOCKED" }, { status: "FAIL" }]), 1);
	});
});

describe("preflight source map", () => {
	it("#given unchanged sources #when checked twice #then both pass, and an edit then blocks", () => {
		const root = fixture({ "contract.md": "EXP-005 full <= 32000\n" });
		const expected = { "contract.md": sha256("EXP-005 full <= 32000\n"), "Rules.md": null };
		assert.equal(checkSources(root, expected).status, "PASS");
		assert.equal(checkSources(root, expected).status, "PASS");
		// Same EXP ID, new meaning: prior evidence for it no longer counts.
		writeFileSync(join(root, "contract.md"), "EXP-005 full <= 99000\n");
		const stale = checkSources(root, expected);
		assert.equal(stale.status, "BLOCKED");
		assert.match(stale.evidence, /contract\.md changed/);
	});
	it("#given a source absent at review #when it appears #then the map is stale", () => {
		const root = fixture({ "Rules.md": "MUST NOT ship on Fridays\n" });
		assert.equal(checkSources(root, { "Rules.md": null }).status, "BLOCKED");
	});
	it("#given a mapped source deleted #when checked #then the gate blocks", () => {
		const root = fixture({});
		assert.equal(checkSources(root, { "AGENTS.md": sha256("x") }).status, "BLOCKED");
	});
});

describe("preflight behavior inventory", () => {
	it("#given only reviewed files with reviewed content #when checked #then scope passes", () => {
		const root = fixture({ "a.ts": "reviewed\n" });
		assert.equal(checkScope(root, ["a.ts"], { "a.ts": sha256("reviewed\n") }).status, "PASS");
	});
	it("#given a reviewed file edited after review #when tests would still pass #then scope blocks", () => {
		const root = fixture({ "a.ts": "edited later\n" });
		const result = checkScope(root, ["a.ts"], { "a.ts": sha256("reviewed\n") });
		assert.equal(result.status, "BLOCKED");
		assert.match(result.evidence, /changed since review a\.ts/);
	});
	it("#given a changed file nobody reviewed #when checked #then scope blocks", () => {
		const root = fixture({ "new-feature.ts": "surprise\n" });
		assert.equal(checkScope(root, ["new-feature.ts"], {}).status, "BLOCKED");
	});
	it("#given build output and the gate itself #when scoped #then they are excluded as declared", () => {
		assert.equal(isScopeFile("packages/mcp/dist/server.js"), false);
		assert.equal(isScopeFile("scripts/preflight.mjs"), false);
		assert.equal(isScopeFile("packages/mcp/src/server.ts"), true);
	});
});

describe("preflight command runner", () => {
	it("#given a command that outlives its deadline #when run #then it is killed and reported as timed out", async () => {
		// The deadline itself is the behavior under test.
		const result = await run([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 200 });
		assert.equal(result.timedOut, true);
	});
	it("#given a command that does not exist #when run #then it is reported missing", async () => {
		const result = await run(["apple-cua-no-such-tool"], { timeoutMs: 5000 });
		assert.equal(result.missing, true);
	});
});

describe("preflight entry point", () => {
	it("#given --plan #when run #then nothing claims readiness and exit is nonzero", () => {
		const result = spawnSync(process.execPath, [GATE, "--plan"], { encoding: "utf8" });
		assert.equal(result.status, 2);
		const lines = result.stdout.trim().split("\n");
		assert.ok(lines.slice(0, -1).every((line) => line.split(" ")[1] === "NOT"));
	});
	it("#given an unknown argument #when run #then it exits with the usage status", () => {
		assert.equal(spawnSync(process.execPath, [GATE, "--bypass"], { encoding: "utf8" }).status, 64);
	});
	it("#given --no-native #when only the native check is selected #then it is blocked, never passed", () => {
		const result = spawnSync(process.execPath, [GATE, "--no-native", "--only", "EXP-016"], { encoding: "utf8" });
		assert.equal(result.status, 2);
		assert.match(result.stdout, /^EXP-016 BLOCKED/m);
	});
});
