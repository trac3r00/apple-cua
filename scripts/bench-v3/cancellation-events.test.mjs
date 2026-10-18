import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("./cancellation-events.swift", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "cancellation-events-test-"));
const binary = join(root, "cancellation-events");
execFileSync("swiftc", [source, "-o", binary], { timeout: 180000 });

const document = join(root, "owned.txt");
writeFileSync(document, "x");
const link = join(root, "owned-link.txt");
symlinkSync(document, link);
const directory = join(root, "dir");
mkdirSync(directory);
const real = realpathSync(document);

const lines = (stdout) =>
	stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
const evaluate = (overrides = {}) => {
	const snapshot = {
		expected_path: document,
		process_count: 1,
		window_matches: 1,
		text_area_count: 1,
		truncated: false,
		...overrides,
	};
	const result = spawnSync(binary, ["--evaluate"], { input: JSON.stringify(snapshot), encoding: "utf8" });
	return { code: result.status, events: lines(result.stdout) };
};
const cli = (args, input) => spawnSync(binary, args, { input, encoding: "utf8", timeout: 20000 });

test.after(() => rmSync(root, { recursive: true, force: true }));

test("#given unique window and text area evidence #when evaluated #then resolved with the canonical path", () => {
	const { code, events } = evaluate({ expected_path: link });
	assert.equal(code, 0);
	assert.deepEqual(events, [{ schema: "cancellation-events-v1", type: "resolved", path: real, status: "ok" }]);
});

test("#given missing, ambiguous or untrusted evidence #when evaluated #then every case is a refusal with its own code", () => {
	const cases = [
		["ax untrusted", { error: "accessibility is not trusted for this process" }, "unavailable", 3],
		["missing document", { expected_path: join(root, "absent.txt") }, "unavailable", 3],
		["directory instead of file", { expected_path: directory }, "unavailable", 3],
		["textedit not running", { process_count: 0 }, "unavailable", 3],
		["multiple processes", { process_count: 2 }, "ambiguous-process", 4],
		["no matching window", { window_matches: 0 }, "missing-window", 4],
		["two matching windows", { window_matches: 2 }, "ambiguous-window", 4],
		["truncated traversal", { truncated: true }, "unavailable", 3],
		["no text area", { text_area_count: 0 }, "missing-text-area", 4],
		["two text areas", { text_area_count: 2 }, "ambiguous-text-area", 4],
	];
	for (const [label, overrides, status, code] of cases) {
		const result = evaluate(overrides);
		assert.equal(result.code, code, label);
		assert.equal(result.events.length, 1, label);
		assert.equal(result.events[0].type, "refused", label);
		assert.equal(result.events[0].status, status, label);
		assert.equal(result.events[0].exit_code, code, label);
		assert.ok(result.events[0].reason, label);
	}
});

test("#given malformed evaluate input #when run #then usage exit 2 without output", () => {
	const result = cli(["--evaluate"], "not json");
	assert.equal(result.status, 2);
	assert.equal(result.stdout, "");
});

test("#given stdin lines #when parsed as commands #then only snapshot and stop are recognised", () => {
	const result = cli(["--commands"], "snapshot\r\n  stop \nSNAPSHOT\nexit\n\n");
	assert.equal(result.status, 0);
	assert.deepEqual(
		lines(result.stdout).map((event) => event.command),
		["snapshot", "stop", "unknown", "unknown"],
	);
});

test("#given bad arguments or an unusable document #when run as CLI #then it refuses before any AX read", () => {
	assert.equal(cli([]).status, 2);
	assert.equal(cli([""]).status, 2);
	assert.equal(cli([document, "0"]).status, 2);
	assert.equal(cli([document, "-1"]).status, 2);
	assert.equal(cli([document, "abc"]).status, 2);
	assert.equal(cli([document, "601"]).status, 2);
	assert.equal(cli([document, "5", "extra"]).status, 2);
	for (const path of [join(root, "does-not-exist.txt"), directory]) {
		const result = cli([path, "5"]);
		assert.equal(result.status, 3);
		const events = lines(result.stdout);
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "refused");
		assert.equal(events[0].status, "unavailable");
	}
});

test("#given the helper source #when scanned #then it uses no input, focus or accessibility-action APIs", () => {
	const text = readFileSync(source, "utf8");
	for (const forbidden of [
		"CGEvent",
		"AXUIElementPerformAction",
		"AXUIElementSetAttributeValue",
		"activate(",
		"NSAppleScript",
		"Process()",
	]) {
		assert.ok(!text.includes(forbidden), forbidden);
	}
});
