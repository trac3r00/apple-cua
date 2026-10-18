import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { McpClient } from "./bench-v2/client.mjs";

// The caller supplies the ID of a task-owned scratch window, never a document
// discovered by title alone. Every action consumes its immediately preceding
// observation token and the final result is explicitly verified.
const windowId = Number(process.argv[2]);
assert.ok(Number.isSafeInteger(windowId) && windowId > 0, "provide a scratch Keynote window ID");
const client = new McpClient({
	command: fileURLToPath(
		new URL("../packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp", import.meta.url),
	),
	args: [fileURLToPath(new URL("../packages/mcp/dist/server.js", import.meta.url))],
	env: {
		APPLE_CUA_DELIVERY: "background",
		APPLE_CUA_CURSOR: "off",
		APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.iWork.Keynote",
	},
});
function payload(result) {
	const text = result.content.find((item) => item.type === "text" && item.text.trim().startsWith("{"))?.text;
	assert.ok(text, JSON.stringify(result));
	const value = JSON.parse(text);
	assert.notEqual(result.isError, true, text);
	return value;
}
try {
	await client.start();
	// This repository server has no set_goal tool; the enclosing active task
	// authorizes this scratch-window QA, and native AppApprovalStore still applies.
	const observation = await client.callTool("get_app_state", {
		app: "Keynote",
		window_id: windowId,
		include_screenshot: false,
		element_format: "json",
		settle_ms: 0,
	});
	const observed = payload(observation);
	assert.equal(observed.frontmost, false);
	const textTool = observed.elements.find((element) => element.role === "AXButton" && element.label === "Text");
	assert.ok(textTool, JSON.stringify(observed));
	const mutation = await client.callTool("run_steps", {
		app: "Keynote",
		observation_token: observed.observation_token,
		steps: [{ type: "click", element_index: String(textTool.id) }],
		full_state: true,
	});
	const action = payload(mutation);
	assert.notEqual(action.paused, true, JSON.stringify(action));
	assert.equal(action.actionDispatched, true, JSON.stringify(action));
	assert.equal(action.runSteps.completed, 1, JSON.stringify(action));
	assert.equal(action.runSteps.stoppedEarly, false, JSON.stringify(action));
	assert.equal(action.runSteps.steps[0]?.input_dispatched, true, JSON.stringify(action));
	assert.equal(action.runSteps.steps[0]?.status, "dispatched", JSON.stringify(action));
	assert.equal(action.frontmost, false);
	const verification = await client.callTool("verify_state", {
		app: "Keynote",
		observation_token: action.observation_token,
		window_title: "Untitled",
	});
	const verified = payload(verification);
	assert.equal(verified.verified, true);
	process.stdout.write(`${JSON.stringify({ verified: true, observed, action, verification: verified })}\n`);
} finally {
	client.stop();
}
