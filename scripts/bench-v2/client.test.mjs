import assert from "node:assert/strict";
import { test } from "node:test";
import { McpClient } from "./client.mjs";

test("#given an exiting MCP process #when initializing #then pending and later requests fail on exit", async () => {
	const client = new McpClient({
		command: process.execPath,
		args: ["-e", "process.exit(7)"],
		env: {},
		timeoutMs: 30000,
	});
	try {
		await assert.rejects(client.start(), /server-exit: 7/);
		await assert.rejects(client.callTool("get_app_state", {}), /server-exit: 7/);
		assert.equal(client.pending.size, 0);
	} finally {
		client.stop();
	}
});
