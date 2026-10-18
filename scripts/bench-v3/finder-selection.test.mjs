import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "finder-selection-test-"));
const binary = join(root, "finder-selection");
execFileSync("swiftc", [fileURLToPath(new URL("./finder-selection.swift", import.meta.url)), "-o", binary], {
	timeout: 120000,
});
const dir = join(root, "owned");
mkdirSync(dir);
writeFileSync(join(dir, "document.txt"), "x");
writeFileSync(join(dir, "other.txt"), "x");
symlinkSync("/etc/hosts", join(dir, "link.txt"));
const real = realpathSync(dir);

const run = (snapshot) => {
	const result = spawnSync(binary, ["--evaluate"], { input: JSON.stringify(snapshot), encoding: "utf8" });
	return { code: result.status, report: JSON.parse(result.stdout) };
};
const snapshot = (overrides = {}) => ({
	title: "owned",
	expected_dir: dir,
	window_matches: 1,
	window_document: `file://${real}/`,
	candidates: [],
	truncated: false,
	...overrides,
});
const candidate = (overrides = {}) => ({
	container: 0,
	provenance: "AXWindow/AXOutline[0]/AXSelectedRows[0]",
	names: [],
	...overrides,
});

test.after(() => rmSync(root, { recursive: true }));

test("#given an AXURL selection in the verified directory #when evaluated #then ok with path and provenance", () => {
	const { code, report } = run(snapshot({ candidates: [candidate({ url: `file://${real}/document.txt` })] }));
	assert.equal(code, 0);
	assert.equal(report.verdict.status, "ok");
	assert.deepEqual(report.verdict.selected, [
		{ path: `${real}/document.txt`, provenance: "AXWindow/AXOutline[0]/AXSelectedRows[0]", method: "AXURL" },
	]);
});

test("#given only name candidates #when evaluated #then the first existing child of the window directory wins", () => {
	const names = [
		{ source: "AXTitle", value: "missing.txt" },
		{ source: "descendant:AXTextField.AXValue", value: "other.txt" },
	];
	const { code, report } = run(snapshot({ candidates: [candidate({ names })] }));
	assert.equal(code, 0);
	assert.equal(report.verdict.selected[0].path, `${real}/other.txt`);
	assert.equal(report.verdict.selected[0].method, "name:descendant:AXTextField.AXValue");
});

test("#given no AXDocument but an independently read window target #when evaluated #then verifies the selected path", () => {
	const { code, report } = run(
		snapshot({
			window_document: undefined,
			window_target: `file://${real}/`,
			candidates: [candidate({ names: [{ source: "descendant:AXTextField.AXValue", value: "document.txt" }] })],
		}),
	);
	assert.equal(code, 0);
	assert.equal(report.verdict.selected[0].path, `${real}/document.txt`);
});

test("#given unverifiable evidence #when evaluated #then every case is refused rather than successful", () => {
	const url = (name) => `file://${real}/${name}`;
	const cases = [
		["empty selection", snapshot(), "empty", 6],
		["missing window", snapshot({ window_matches: 0 }), "missing-window", 4],
		["ambiguous window", snapshot({ window_matches: 2 }), "ambiguous-window", 4],
		[
			"no document",
			snapshot({ window_document: undefined, candidates: [candidate({ url: url("document.txt") })] }),
			"unavailable",
			3,
		],
		[
			"wrong directory",
			snapshot({ window_document: `file://${root}/`, candidates: [candidate({ url: url("document.txt") })] }),
			"unavailable",
			3,
		],
		[
			"truncated traversal",
			snapshot({ truncated: true, candidates: [candidate({ url: url("document.txt") })] }),
			"unavailable",
			3,
		],
		["ax error", snapshot({ error: "Finder is not running" }), "unavailable", 3],
		[
			"unresolvable name",
			snapshot({ candidates: [candidate({ names: [{ source: "AXTitle", value: "missing.txt" }] })] }),
			"unavailable",
			3,
		],
		[
			"traversal name",
			snapshot({ candidates: [candidate({ names: [{ source: "AXTitle", value: "../owned/document.txt" }] })] }),
			"unavailable",
			3,
		],
		["outside directory", snapshot({ candidates: [candidate({ url: `file://${root}` })] }), "unavailable", 3],
		[
			"two containers",
			snapshot({
				candidates: [candidate({ url: url("document.txt") }), candidate({ container: 1, url: url("other.txt") })],
			}),
			"ambiguous",
			5,
		],
	];
	for (const [label, input, status, code] of cases) {
		const result = run(input);
		assert.equal(result.report.verdict.status, status, label);
		assert.equal(result.code, code, label);
	}
	// A symlink child reports the link itself inside the directory, never its target.
	const link = run(snapshot({ candidates: [candidate({ url: url("link.txt") })] }));
	assert.equal(link.report.verdict.selected[0].path, `${real}/link.txt`);
});

test("#given a missing owned directory #when run as CLI #then it refuses before any AX read", () => {
	const result = spawnSync(binary, ["owned", join(root, "does-not-exist")], { encoding: "utf8" });
	assert.equal(result.status, 3);
	assert.equal(JSON.parse(result.stdout).verdict.status, "unavailable");
	assert.equal(spawnSync(binary, ["only-title"], { encoding: "utf8" }).status, 2);
});
