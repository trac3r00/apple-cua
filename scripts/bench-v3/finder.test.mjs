import assert from "node:assert/strict";
import test from "node:test";
import {
	closeOwnedFinderWindow,
	combineCleanupErrors,
	diskOracle,
	ownedWindow,
	pathOracle,
	scenarioPlan,
	selectionOracle,
} from "./finder-run.mjs";

test("#given task and cleanup failures #when combining them #then retain both failures", () => {
	const taskError = new Error("task failed");
	const cleanupError = new Error("cleanup failed");
	const error = combineCleanupErrors(true, taskError, [cleanupError], "Finder cleanup failed");
	assert.ok(error instanceof AggregateError);
	assert.equal(error.message, "Finder cleanup failed");
	assert.equal(error.errors[0], taskError);
	assert.equal(error.errors[1], cleanupError);
});

if (process.env.BENCH_LIVE_FINDER === "1")
	test("#given an owned live Finder window #when cleanup runs #then only that window closes", async () => {
		const { execFileSync } = await import("node:child_process");
		const { mkdtempSync, rmSync } = await import("node:fs");
		const dir = mkdtempSync("/tmp/cua-bench/finder-cleanup-test-");
		const osa = (script) => execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();
		let id;
		try {
			const before = osa('tell application "Finder" to get id of every window');
			id = Number(
				osa(`tell application "Finder" to get id of (make new Finder window to (POSIX file "${dir}" as alias))`),
			);
			assert.ok(Number.isInteger(id));
			assert.equal(closeOwnedFinderWindow(id), true);
			assert.equal(osa('tell application "Finder" to get id of every window'), before);
		} finally {
			if (id !== undefined)
				osa(`tell application "Finder"\nif exists window id ${id} then close window id ${id}\nend tell`);
			rmSync(dir, { recursive: true });
		}
	});

test("#given four Finder scenarios #when plans are built #then v2 logical steps are preserved", () => {
	const scenarios = ["finder-create-folder", "finder-navigate", "finder-rename-file", "finder-select-file"];
	for (const scenario of scenarios) assert.ok(scenarioPlan(scenario, "/tmp/fixture").length > 0);
	assert.equal(scenarioPlan("finder-navigate", "/tmp/fixture")[2].value, "/tmp/fixture");
	assert.throws(() => scenarioPlan("finder-unknown", "/tmp"), /unsupported Finder scenario/);
});

test("#given a driver window list #when matching an owned id and title #then rejects ambiguous ownership", () => {
	const rows = [
		{ app_name: "Finder", window_id: 4, title: "fixture" },
		{ app_name: "Finder", window_id: 5, title: "user" },
	];
	assert.equal(ownedWindow(rows, "Finder", 4, "fixture"), rows[0]);
	assert.throws(() => ownedWindow(rows, "Finder", 5, "fixture"), /owned window mismatch/);
	assert.throws(() => ownedWindow([...rows, rows[0]], "Finder", 4, "fixture"), /owned window mismatch/);
});

test("#given independent filesystem state #when checking folder and rename outcomes #then exact disk facts decide", async () => {
	const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "finder-oracle-"));
	try {
		assert.equal(diskOracle("finder-create-folder", dir), false);
		mkdirSync(join(dir, "bench-folder"));
		assert.equal(diskOracle("finder-create-folder", dir), true);
		writeFileSync(join(dir, "document.txt"), "x");
		assert.equal(diskOracle("finder-rename-file", dir), false);
		writeFileSync(join(dir, "renamed.txt"), "x");
		rmSync(join(dir, "document.txt"));
		assert.equal(diskOracle("finder-rename-file", dir), true);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("#given resolved paths and selection #when applying independent oracles #then aliases compare by real path", async () => {
	const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "finder-path-"));
	const child = join(dir, "target");
	mkdirSync(child);
	try {
		assert.equal(pathOracle(child, child), true);
		assert.equal(selectionOracle([child], child), true);
		assert.equal(selectionOracle([], child), false);
		assert.equal(selectionOracle([child, child], child), false);
	} finally {
		rmSync(dir, { recursive: true });
	}
});
