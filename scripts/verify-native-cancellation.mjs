import assert from "node:assert/strict";
import { readFileSync, statSync, watch } from "node:fs";
import { InputInterrupted, runInInputScope } from "../packages/core/dist/computer/input-scope.js";
import { extractAccessibilityTree } from "../packages/core/dist/platform/macos-ffi/accessibility.js";
import { listWindows } from "../packages/core/dist/platform/macos-ffi/window-list.js";
import { MacOSHostComputer } from "../packages/core/dist/platform/macos.js";

const fixtureTitle = process.env.APPLE_CUA_FIXTURE_TITLE ?? "apple-cua Background Input QA";
const windows = listWindows({ onScreenOnly: false });
assert.ok(windows, "native window enumeration unavailable; check Screen Recording permission");
const window = windows.filter((item) => item.title === fixtureTitle).sort((a, b) => b.id - a.id)[0];
assert.ok(window, `live task-owned fixture window required: ${fixtureTitle}`);
const tree = extractAccessibilityTree(window.ownerPid, { windowId: window.id });
const canvas = tree.elements.find((item) => item.label === "Custom drawing canvas");
assert.ok(canvas);
const log = process.env.APPLE_CUA_FIXTURE_SECOND_LOG ?? "/tmp/apple-cua-fixture-second.jsonl";
const offset = statSync(log).size;
let stopped = false;
let timer;
let watcher;
const events = [];
const released = new Promise((resolve, reject) => {
	timer = setTimeout(() => reject(new Error("cancelled native gesture did not release")), 5000);
	watcher = watch(log, () => {
		const lines = readFileSync(log).subarray(offset).toString("utf8").split("\n").filter(Boolean);
		events.length = 0;
		for (const line of lines) {
			try {
				events.push(JSON.parse(line));
			} catch {
				/* incomplete final line */
			}
		}
		if (events.some((event) => event.event === "mouseDragged")) stopped = true;
		const upIndex = events.findIndex((event) => event.event === "mouseUp");
		if (
			upIndex !== -1 &&
			events
				.slice(upIndex + 1)
				.some(
					(event) =>
						event.event === "modifierChanged" &&
						event.previousModifiers.includes("option") &&
						!event.modifiers.includes("option"),
				)
		) {
			watcher.close();
			resolve();
		}
	});
});
released.catch(() => undefined);
const computer = new MacOSHostComputer({ delivery: "background" });
try {
	await assert.rejects(
		runInInputScope(
			{
				target: { pid: window.ownerPid, windowId: window.id },
				interruption: () => (stopped ? "native QA cancellation" : undefined),
			},
			() =>
				computer.drag({
					from: { x: canvas.frame.x + 500, y: canvas.frame.y + 200 },
					to: { x: canvas.frame.x + 700, y: canvas.frame.y + 300 },
					duration: 1500,
					button: "right",
					modifiers: ["option"],
				}),
		),
		InputInterrupted,
	);
	await released;
	const up = events.find((event) => event.event === "mouseUp");
	assert.equal(up.button, 1);
	assert.ok(up.modifiers.includes("option"), "Option missing from native mouseUp");
	const gesture = events.filter((event) => ["mouseDown", "mouseDragged", "mouseUp"].includes(event.event));
	assert.ok(
		gesture.every((event) => event.modifiers.includes("option")),
		"Option missing during native gesture",
	);
	assert.equal(up.orbit.dragging, false);
	assert.ok(up.locationInCanvas.x < 700, "cancellation did not stop before endpoint");
	process.stdout.write(`${JSON.stringify({ verified: true, pid: window.ownerPid, up })}\n`);
} finally {
	clearTimeout(timer);
	watcher.close();
	computer.close();
}
