import assert from "node:assert/strict";
import { readFileSync, statSync, watch } from "node:fs";
import { InputInterrupted, runInInputScope } from "../packages/core/dist/computer/input-scope.js";
import { extractAccessibilityTree } from "../packages/core/dist/platform/macos-ffi/accessibility.js";
import { listWindows } from "../packages/core/dist/platform/macos-ffi/window-list.js";
import { MacOSHostComputer } from "../packages/core/dist/platform/macos.js";

const fixtureTitle = process.env.APPLE_CUA_FIXTURE_TITLE ?? "apple-cua Background Input QA";
const window = listWindows({ onScreenOnly: false })
	.filter((item) => item.title === fixtureTitle)
	.sort((a, b) => b.id - a.id)[0];
assert.ok(window);
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
		const lines = readFileSync(log, "utf8").slice(offset).split("\n").filter(Boolean);
		events.length = 0;
		for (const line of lines) {
			try {
				events.push(JSON.parse(line));
			} catch {
				/* incomplete final line */
			}
		}
		if (events.some((event) => event.event === "mouseDragged")) stopped = true;
		if (events.some((event) => event.event === "mouseUp")) {
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
	assert.equal(up.orbit.dragging, false);
	assert.ok(up.locationInCanvas.x < 700, "cancellation did not stop before endpoint");
	process.stdout.write(`${JSON.stringify({ verified: true, pid: window.ownerPid, up })}\n`);
} finally {
	clearTimeout(timer);
	watcher.close();
	computer.close();
}
