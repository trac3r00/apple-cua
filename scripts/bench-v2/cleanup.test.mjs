import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupAttempt, cleanupPlan } from "./cleanup.mjs";

const app = { bundle: "com.apple.TextEdit", pid: 42 };
const spec = { fixture: "text", id: "textedit-fill-save", steps: [{ app: "TextEdit" }] };

test("#given pre-existing and fixture windows #when planning cleanup #then only new fixture windows close", () => {
	// Given: TextEdit was running, with a user's own document already on screen.
	const existing = { pid: 42, number: 11, title: "personal.txt", owner: "TextEdit" };
	const baseline = { apps: [app], windows: [existing] };
	const current = {
		apps: [app],
		windows: [existing, { pid: 42, number: 12, title: "document.txt" }, { pid: 42, number: 13, title: "notes.txt" }],
	};
	// When: the cleanup plan diffs the snapshots.
	const plan = cleanupPlan(baseline, current, spec);
	// Then: the user window is neither closed nor is the running app quit.
	assert.deepEqual(plan.quit, []);
	assert.deepEqual(
		plan.windows.map((window) => window.number),
		[12],
	);
	assert.deepEqual(
		plan.newWindows.map((window) => window.number),
		[12, 13],
	);
});

test("#given duplicate titles #when cleaning a fixture window #then no user's window is targeted", async () => {
	// Given: a pre-existing same-titled window and a new fixture window.
	const existing = { pid: 42, number: 11, title: "document.txt" };
	let current = { apps: [app], windows: [existing, { ...existing, number: 12 }] };
	const targeted = [];
	const probe = {
		snapshot: () => current,
		async closeWindowByNumber(_bundle, _pid, number) {
			targeted.push(number);
			current = { ...current, windows: current.windows.filter((window) => window.number !== number) };
		},
	};
	// When: cleanup sees the duplicate title.
	const result = await cleanupAttempt(probe, { apps: [app], windows: [existing] }, spec, "unused");
	// Then: title-based AppleScript is skipped and only the new window is closed, by its number.
	assert.deepEqual(targeted, [12]);
	assert.equal(result.closed.length, 1);
	assert.deepEqual(result.leftover, []);
	assert.deepEqual(
		current.windows.map((window) => window.number),
		[11],
	);
});

test("#given an app absent before the run #when planning cleanup #then the launched app is quit", () => {
	// Given: a newly launched TextEdit with a benchmark document.
	const baseline = { apps: [], windows: [] };
	const current = { apps: [app], windows: [{ pid: 42, number: 12, title: "document.txt" }] };
	// When: planning cleanup.
	const plan = cleanupPlan(baseline, current, spec);
	// Then: quit, never an individual close in an app this run owns entirely.
	assert.deepEqual(plan.quit, [app]);
	assert.deepEqual(plan.windows, []);
});
