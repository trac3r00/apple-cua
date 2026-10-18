import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { McpClient } from "../bench-v2/client.mjs";

const url = execFileSync("osascript", ["-e", 'tell application "Safari" to get URL of current tab of window id 6601'], {
	encoding: "utf8",
	timeout: 10000,
}).trim();
if (url !== "http://127.0.0.1:55387/page") throw new Error("owned Safari URL changed; refusing inspection");
const client = new McpClient({
	command: "node",
	args: ["packages/mcp/dist/server.js"],
	env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.Safari", APPLE_CUA_DELIVERY: "background" },
});
try {
	await client.start();
	const result = await client.callTool("get_app_state", {
		app: "com.apple.Safari",
		window_id: 6601,
		include_screenshot: true,
		element_format: "table",
		max_elements: 100,
	});
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	writeFileSync(".bench/v3/safari-owned-recovery-state.json", text);
	for (const block of result.content)
		if (block.type === "image") {
			const path = `.bench/v3/safari-owned-recovery.${block.mimeType === "image/jpeg" ? "jpg" : "png"}`;
			writeFileSync(path, Buffer.from(block.data, "base64"));
			process.stdout.write(`Screenshot: ${path}\n`);
		}
	process.stdout.write(`${text}\n`);
} finally {
	client.stop();
}
