import assert from "node:assert/strict";
import { readFileSync, statSync, watch } from "node:fs";
import { writeFile } from "node:fs/promises";
import { extractAccessibilityTree } from "../packages/core/dist/platform/macos-ffi/accessibility.js";
import { getCurrentCursorPosition } from "../packages/core/dist/platform/macos-ffi/coregraphics.js";
import { listWindows } from "../packages/core/dist/platform/macos-ffi/window-list.js";
import { getRunningApplications } from "../packages/core/dist/platform/macos-ffi/workspace.js";
import { MacOSHostComputer, captureMacOSScreenshot } from "../packages/core/dist/platform/macos.js";

const fixtureTitle = process.env.APPLE_CUA_FIXTURE_TITLE ?? "apple-cua Background Input QA";
const window = listWindows({ onScreenOnly: false })
	?.filter((item) => item.title === fixtureTitle)
	.sort((first, second) => second.id - first.id)[0];
assert.ok(window, "live task-owned fixture window required");
const pid = window.ownerPid;
const computer = new MacOSHostComputer({ defaultTargetPid: pid, delivery: "background" });
const tree = extractAccessibilityTree(pid, { windowId: window.id, maxElements: 100 });
assert.equal(tree.axAvailable, true, JSON.stringify({ pid, window, tree }));
const before = {
	front: getRunningApplications().find((app) => app.isActive)?.pid,
	pointer: getCurrentCursorPosition(),
	frame: tree.elements.find((element) => element.role === "AXWindow")?.frame,
};
assert.ok(before.frame, "fixture must publish its actual AX window frame");
assert.notEqual(before.front, pid);
const center = (label) => {
	const element = tree.elements.find((item) => item.label === label);
	assert.ok(element, `missing observed control ${label}`);
	return { x: element.frame.x + element.frame.width / 2, y: element.frame.y + element.frame.height / 2 };
};
const canvas = tree.elements.find((item) => item.label === "Custom drawing canvas");
assert.ok(canvas, JSON.stringify(tree));
const point = (x, y) => ({ x: canvas.frame.x + x, y: canvas.frame.y + y });
try {
	await computer.click(center("Draw"));
	await computer.drag({
		from: point(60, 160),
		to: point(330, 180),
		waypoints: [point(140, 90), point(220, 230)],
		duration: 700,
	});
	await computer.click(center("Shape"));
	await computer.drag({ from: point(350, 220), to: point(500, 340), duration: 400 });
	await computer.click(center("Orbit"));
	await computer.drag({
		from: point(600, 100),
		to: point(680, 160),
		button: "right",
		modifiers: ["option"],
		duration: 400,
	});
	const finalTree = extractAccessibilityTree(pid, { windowId: window.id, maxElements: 100 });
	const value = finalTree.elements.find((item) => item.label === "Custom drawing canvas")?.value;
	assert.equal(typeof value, "string", "canvas must publish actual resulting state");
	const state = JSON.parse(value);
	assert.ok(state.strokes.length >= 1, JSON.stringify(state));
	assert.ok(state.strokes.at(-1).length > 3, "stroke must include intermediate samples");
	assert.ok(state.shapes.length >= 1, JSON.stringify(state));
	assert.notEqual(state.yaw, 0.65, `orbit projection unchanged: ${JSON.stringify(state)}`);
	assert.equal(state.mode, "orbit");
	await computer.click(center("Text"));
	await computer.click(center("Text input"));
	const log = process.env.APPLE_CUA_FIXTURE_LOG ?? "/tmp/apple-cua-fixture-focus.jsonl";
	const offset = statSync(log).size;
	let watcher;
	let timer;
	const edited = new Promise((resolve, reject) => {
		watcher = watch(log, () => {
			const lines = readFileSync(log, "utf8").slice(offset).split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const event = JSON.parse(line);
					if (event.event === "textEditing" && event.value === "native QA") resolve();
				} catch {
					/* incomplete final line */
				}
			}
		});
		timer = setTimeout(() => reject(new Error("native text edit was not received")), 5000);
	});
	edited.catch(() => undefined);
	try {
		await computer.type("native QA");
		await edited;
	} finally {
		clearTimeout(timer);
		watcher.close();
	}
	const textTree = extractAccessibilityTree(pid, { windowId: window.id, maxElements: 100 });
	assert.equal(textTree.elements.find((item) => item.label === "Text input")?.value, "native QA");
	const after = {
		front: getRunningApplications().find((app) => app.isActive)?.pid,
		pointer: getCurrentCursorPosition(),
		frame: textTree.elements.find((element) => element.role === "AXWindow")?.frame,
	};
	assert.equal(after.front, before.front, "foreground app changed");
	assert.deepEqual(after.pointer, before.pointer, "hardware pointer changed during native QA");
	assert.deepEqual(after.frame, before.frame, "fixture window moved");
	if (process.env.APPLE_CUA_FIXTURE_SCREENSHOT !== undefined) {
		const captured = await captureMacOSScreenshot(
			{ width: before.frame.width * 2, height: before.frame.height * 2 },
			window.id,
			"jpeg",
			85,
		);
		assert.ok(captured.length > 0, "fixture screenshot was unavailable");
		await writeFile(process.env.APPLE_CUA_FIXTURE_SCREENSHOT, captured);
	}
	process.stdout.write(`${JSON.stringify({ verified: true, pid, windowId: window.id, state, before, after })}\n`);
} finally {
	computer.close();
}
