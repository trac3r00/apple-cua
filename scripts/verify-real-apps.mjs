import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { getCurrentCursorPosition } from "../packages/core/dist/platform/macos-ffi/coregraphics.js";
import { getRunningApplications } from "../packages/core/dist/platform/macos-ffi/workspace.js";
import { McpClient } from "./bench-v2/client.mjs";

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
		for (const [app, windowId] of [
			["Keynote", 17182],
			["Freeform", 17244],
		]) {
			const state = payload(
				await client.callTool("get_app_state", {
					app,
					window_id: windowId,
					include_screenshot: false,
					element_format: "json",
					settle_ms: 0,
				}),
			);
			if (process.argv[2] === app) {
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
				process.stdout.write(`${JSON.stringify({ app, action })}\n`);
				continue;
			}
			const verified = payload(
				await client.callTool("verify_state", {
					app,
					observation_token: state.observation_token,
					window_title: state.windowTitle,
				}),
			);
			process.stdout.write(`${JSON.stringify({ app, state, verified })}\n`);
		}
	}
} finally {
	client.stop();
}
