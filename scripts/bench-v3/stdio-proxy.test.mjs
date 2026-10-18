import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { McpClient } from "../bench-v2/client.mjs";

test("#given transparent MCP proxy #when tool executes #then records one request without rewriting response", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cua-proxy-"));
	const log = join(dir, "trace.jsonl");
	const server = `
let buffer="";process.stdin.on("data",chunk=>{buffer+=chunk;let end;
while((end=buffer.indexOf("\\n"))>=0){const r=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
if(!("id" in r))continue;process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:r.id,
result:r.method==="tools/call"?{content:[{type:"text",text:"exact"}]}:{}})+"\\n");}});
`;
	const client = new McpClient({
		command: process.execPath,
		args: [new URL("./stdio-proxy.mjs", import.meta.url).pathname, log, process.execPath, "-e", server],
	});
	let exited;
	try {
		await client.start();
		const result = await client.callTool("owned_task", { marker: "fixture" });
		assert.equal(result.content[0].text, "exact");
		const records = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(records.filter((row) => row.direction === "request").length, 1);
		assert.equal(records.find((row) => row.direction === "request").tool, "owned_task");
		assert.equal(records.find((row) => row.direction === "response").isError, false);
	} finally {
		exited = new Promise((resolve) => client.child.once("exit", resolve));
		client.stop();
	}
	// The process owns its trace until its exit notification has been handled.
	await exited;
	rmSync(dir, { recursive: true });
});
