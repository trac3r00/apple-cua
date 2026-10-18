import { chmodSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { getCurrentCursorPosition } from "../packages/core/dist/platform/macos-ffi/coregraphics.js";
import { getRunningApplications } from "../packages/core/dist/platform/macos-ffi/workspace.js";
import { McpClient } from "./bench-v2/client.mjs";

// Private QA transport only. All observations and inputs still go through MCP guards.
const client = new McpClient({
	command: fileURLToPath(
		new URL("../packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp", import.meta.url),
	),
	args: [fileURLToPath(new URL("../packages/mcp/dist/server.js", import.meta.url))],
	env: {
		APPLE_CUA_DELIVERY: "background",
		APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.freeform,com.apple.iWork.Keynote,com.apple.Keynote",
	},
	timeoutMs: 125000,
});
await client.start();
const path = `/tmp/apple-cua-workflow-${process.pid}.sock`;
let sequence = 0;
function desktop() {
	return {
		front: getRunningApplications().find((app) => app.isActive)?.pid,
		pointer: getCurrentCursorPosition(),
	};
}
const server = createServer((socket) => {
	let input = "";
	socket.on("data", async (data) => {
		input += data.toString();
		if (!input.endsWith("\n")) return;
		socket.pause();
		const request = JSON.parse(input);
		const started = performance.now();
		const before = desktop();
		try {
			const result = await client.callTool(request.name, request.args);
			const receipt = {
				n: ++sequence,
				name: request.name,
				ms: performance.now() - started,
				before,
				after: desktop(),
			};
			process.stdout.write(`${JSON.stringify(receipt)}\n`);
			socket.end(`${JSON.stringify({ result, receipt })}\n`);
		} catch (error) {
			socket.end(`${JSON.stringify({ error: String(error) })}\n`);
		}
	});
});
server.listen(path, () => {
	chmodSync(path, 0o600);
	process.stdout.write(`READY ${path}\n`);
});
process.on("SIGTERM", () => {
	client.stop();
	server.close();
	unlinkSync(path);
	process.exit(0);
});
