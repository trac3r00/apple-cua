import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { getCurrentCursorPosition } from "../packages/core/dist/platform/macos-ffi/coregraphics.js";
import { listWindows } from "../packages/core/dist/platform/macos-ffi/window-list.js";
import { getRunningApplications } from "../packages/core/dist/platform/macos-ffi/workspace.js";
import { McpClient } from "./bench-v2/client.mjs";

// Supply exact task-owned targets; historical WindowServer IDs are not reusable.
const targets =
	process.argv[2] === "session"
		? []
		: [
				{ app: "Keynote", bundleId: "com.apple.iWork.Keynote", prefix: "APPLE_CUA_KEYNOTE" },
				{ app: "Freeform", bundleId: "com.apple.freeform", prefix: "APPLE_CUA_FREEFORM" },
			]
				.filter((target) => !["Keynote", "Freeform"].includes(process.argv[2]) || target.app === process.argv[2])
				.map((target) => {
					const windowId = Number(process.env[`${target.prefix}_WINDOW_ID`]);
					const title = process.env[`${target.prefix}_WINDOW_TITLE`];
					assert.ok(Number.isSafeInteger(windowId) && windowId > 0, `set ${target.prefix}_WINDOW_ID`);
					assert.ok(title?.trim(), `set ${target.prefix}_WINDOW_TITLE to the intended scratch document title`);
					const expectedLabel = process.env.APPLE_CUA_KEYNOTE_EXPECT_LABEL;
					const expectedTitle = process.env.APPLE_CUA_FREEFORM_EXPECT_TITLE;
					if (process.argv[2] === "Keynote") {
						assert.ok(expectedLabel?.trim(), "set APPLE_CUA_KEYNOTE_EXPECT_LABEL to a newly opened picker label");
					}
					if (process.argv[2] === "Freeform") {
						assert.ok(expectedTitle?.trim(), "set APPLE_CUA_FREEFORM_EXPECT_TITLE to the new board title");
					}
					return { ...target, windowId, title, expectedLabel, expectedTitle };
				});

const client = new McpClient({
	command: fileURLToPath(
		new URL("../packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp", import.meta.url),
	),
	args: [fileURLToPath(new URL("../packages/mcp/dist/server.js", import.meta.url))],
	env: {
		APPLE_CUA_DELIVERY: "background",
		APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.freeform,com.apple.iWork.Keynote",
	},
});
function payload(result) {
	if (result.isError) throw new Error(JSON.stringify(result));
	return JSON.parse(result.content.find((item) => item.type === "text").text);
}
try {
	await client.start();
	if (process.argv[2] === "session") {
		process.stdout.write("READY\n");
		for await (const line of createInterface({ input: process.stdin })) {
			const request = JSON.parse(line);
			let before;
			if (request.measure) {
				before = {
					front: getRunningApplications().find((app) => app.isActive)?.pid,
					pointer: getCurrentCursorPosition(),
				};
			}
			const result = await client.callTool(request.name, request.args);
			process.stdout.write(`${JSON.stringify(result)}\n`);
			if (before !== undefined) {
				process.stdout.write(
					`${JSON.stringify({
						measurement: {
							before,
							after: {
								front: getRunningApplications().find((app) => app.isActive)?.pid,
								pointer: getCurrentCursorPosition(),
							},
						},
					})}\n`,
				);
			}
		}
	} else {
		for (const { app, bundleId, windowId, title, expectedLabel, expectedTitle } of targets) {
			const beforeWindows = listWindows({ onScreenOnly: false });
			const window = beforeWindows?.find((item) => item.id === windowId);
			assert.ok(window, `intended ${app} window ${windowId} is unavailable`);
			assert.equal(window.title, title, `window ${windowId} is not the intended scratch document`);
			const owner = getRunningApplications().find((item) => item.pid === window.ownerPid);
			assert.equal(owner?.bundleId, bundleId, `window ${windowId} does not belong to ${app}`);
			const state = payload(
				await client.callTool("get_app_state", {
					app,
					window_id: windowId,
					include_screenshot: false,
					element_format: "json",
					settle_ms: 0,
				}),
			);
			assert.equal(state.windowId, windowId, "observation resolved a different window");
			assert.equal(state.pid, window.ownerPid, "observation resolved a different process");
			assert.equal(state.windowTitle, title, "observation resolved a different document");
			if (process.argv[2] === app) {
				if (app === "Keynote") {
					assert.ok(
						!state.elements.some((item) => item.label === expectedLabel),
						"expected picker label is already present before the action",
					);
				}
				const label = app === "Keynote" ? "Shape" : "New Board";
				const element = state.elements.find(
					(item) => item.label === label && (app !== "Keynote" || item.role === "AXCheckBox"),
				);
				if (!element) throw new Error(`missing observed ${label}`);
				const action = payload(
					await client.callTool("run_steps", {
						app,
						observation_token: state.observation_token,
						steps: [{ type: "click", element_index: String(element.id) }],
						full_state: true,
						include_screenshot: false,
					}),
				);
				assert.equal(action.actionDispatched, true, JSON.stringify(action));
				assert.equal(action.runSteps.completed, 1, JSON.stringify(action));
				assert.equal(action.runSteps.steps[0]?.input_dispatched, true, JSON.stringify(action));
				assert.equal(action.runSteps.stoppedEarly, false, JSON.stringify(action));
				if (app === "Keynote") {
					assert.ok(
						action.elements?.some((item) => item.label === expectedLabel),
						`Shape picker did not expose expected label ${expectedLabel}`,
					);
				} else {
					const created = listWindows({ onScreenOnly: false })?.find(
						(item) =>
							item.ownerPid === window.ownerPid &&
							item.title === expectedTitle &&
							!beforeWindows.some((prior) => prior.id === item.id),
					);
					assert.ok(created, `New Board did not create the intended ${expectedTitle} window`);
				}
				process.stdout.write(`${JSON.stringify({ app, action, effectVerified: true })}\n`);
				continue;
			}
			const verified = payload(
				await client.callTool("verify_state", {
					app,
					observation_token: state.observation_token,
					window_title: title,
				}),
			);
			assert.equal(verified.verified, true, JSON.stringify(verified));
			process.stdout.write(`${JSON.stringify({ app, state, verified })}\n`);
		}
	}
} finally {
	client.stop();
}
