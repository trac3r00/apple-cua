import assert from "node:assert/strict";
import { readFileSync, statSync, watch } from "node:fs";
import { runInInputScope } from "../packages/core/dist/computer/input-scope.js";
import { extractAccessibilityTree } from "../packages/core/dist/platform/macos-ffi/accessibility.js";
import { getCurrentCursorPosition } from "../packages/core/dist/platform/macos-ffi/coregraphics.js";
import { listWindows } from "../packages/core/dist/platform/macos-ffi/window-list.js";
import { getRunningApplications } from "../packages/core/dist/platform/macos-ffi/workspace.js";
import { MacOSHostComputer } from "../packages/core/dist/platform/macos.js";

const fixtureTitle = process.env.APPLE_CUA_FIXTURE_TITLE ?? "apple-cua Background Input QA";
const candidates = listWindows({ onScreenOnly: false })
	.filter((window) => window.title === fixtureTitle)
	.sort((a, b) => b.id - a.id);
const windows = [];
for (const window of candidates) {
	if (windows.some((item) => item.ownerPid === window.ownerPid)) continue;
	const tree = extractAccessibilityTree(window.ownerPid, { windowId: window.id });
	const axFrame = tree.elements.find((element) => element.role === "AXWindow")?.frame;
	if (tree.axAvailable && axFrame !== undefined) windows.push({ ...window, axFrame });
	if (windows.length === 2) break;
}
assert.equal(windows.length, 2, "two live fixture processes required");
const computer = new MacOSHostComputer({ delivery: "background" });
const before = {
	front: getRunningApplications().find((app) => app.isActive)?.pid,
	pointer: getCurrentCursorPosition(),
};
try {
	const settled = await Promise.allSettled(
		windows.map((window, index) =>
			runInInputScope(
				{
					target: { pid: window.ownerPid, windowId: window.id },
				},
				async () => {
					const tree = extractAccessibilityTree(window.ownerPid, { windowId: window.id });
					const button = tree.elements.find((element) => element.label === "Draw");
					const canvas = tree.elements.find((element) => element.label === "Custom drawing canvas");
					assert.ok(button && canvas);
					const initial = JSON.parse(canvas.value);
					await computer.click({ x: button.frame.x + 20, y: button.frame.y + 10 });
					const log =
						index === 0
							? (process.env.APPLE_CUA_FIXTURE_SECOND_LOG ?? "/tmp/apple-cua-fixture-second.jsonl")
							: (process.env.APPLE_CUA_FIXTURE_FIRST_LOG ?? "/tmp/apple-cua-fixture-focus.jsonl");
					const offset = statSync(log).size;
					let watcher;
					let timer;
					const released = new Promise((resolve, reject) => {
						watcher = watch(log, () => {
							const appended = readFileSync(log).subarray(offset).toString("utf8");
							if (
								appended.split("\n").some((line) => {
									try {
										return JSON.parse(line).event === "mouseUp";
									} catch {
										return false;
									}
								})
							)
								resolve();
						});
						timer = setTimeout(() => reject(new Error("native mouseUp missing")), 5000);
					});
					released.catch(() => undefined);
					const started = performance.now();
					try {
						await computer.drag({
							from: { x: canvas.frame.x + 50, y: canvas.frame.y + 250 + index * 40 },
							to: { x: canvas.frame.x + 250, y: canvas.frame.y + 250 + index * 40 },
							duration: 500,
						});
						await released;
					} finally {
						clearTimeout(timer);
						watcher.close();
					}
					const finished = performance.now();
					const finalTree = extractAccessibilityTree(window.ownerPid, { windowId: window.id });
					const state = JSON.parse(
						finalTree.elements.find((element) => element.label === "Custom drawing canvas").value,
					);
					assert.equal(state.strokes.length, initial.strokes.length + 1);
					return { pid: window.ownerPid, started, finished, stroke: state.strokes.at(-1) };
				},
			),
		),
	);
	const failures = settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
	if (failures.length > 0) throw new AggregateError(failures, "native input lane failed");
	const results = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	assert.notDeepEqual(results[0].stroke, results[1].stroke, "native lanes produced identical strokes");
	assert.ok(
		Math.max(...results.map((item) => item.started)) < Math.min(...results.map((item) => item.finished)),
		"native gestures did not overlap",
	);
	assert.equal(getRunningApplications().find((app) => app.isActive)?.pid, before.front);
	assert.deepEqual(getCurrentCursorPosition(), before.pointer);
	for (const window of windows) {
		const current = extractAccessibilityTree(window.ownerPid, { windowId: window.id });
		assert.deepEqual(current.elements.find((element) => element.role === "AXWindow")?.frame, window.axFrame);
	}
	process.stdout.write(`${JSON.stringify({ verified: true, results, before })}\n`);
} finally {
	computer.close();
}
