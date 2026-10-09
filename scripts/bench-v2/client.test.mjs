import assert from "node:assert/strict";
import { on } from "node:events";
import { test } from "node:test";
import { McpClient } from "./client.mjs";

const timeout = (promise, label) =>
	Promise.race([
		promise,
		new Promise((_, reject) => {
			const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2000);
			promise.then(
				() => clearTimeout(timer),
				() => clearTimeout(timer),
			);
		}),
	]);

const startFixture = async (source) => {
	const client = new McpClient({
		command: process.execPath,
		args: ["-e", source],
		env: {},
		timeoutMs: 5000,
	});
	await timeout(client.start(), "fixture initialization");
	return client;
};

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

test("#given malformed stdout noise #when initializing #then the protocol error rejects initialization and future calls", async () => {
	const client = new McpClient({
		command: process.execPath,
		args: ["-e", 'process.stdin.on("data", () => process.stdout.write("not-json\\n"));'],
		env: {},
		timeoutMs: 5000,
	});
	try {
		await assert.rejects(timeout(client.start(), "malformed stdout"), /protocol-error: invalid JSON-RPC stdout/);
		assert.equal(client.pending.size, 0);
		await assert.rejects(client.callTool("later", {}), /protocol-error: invalid JSON-RPC stdout/);
	} finally {
		client.stop();
	}
});

test("#given fragmented JSON lines #when requests run concurrently #then responses correlate by id out of order", async () => {
	const client = await startFixture(`
		let initialized = false;
		process.stdin.setEncoding("utf8");
		let buffer = "";
		process.stdin.on("data", (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf("\\n")) >= 0) {
				const request = JSON.parse(buffer.slice(0, index));
				buffer = buffer.slice(index + 1);
				if (request.method === "finish-fragments") {
					process.stdout.write(globalThis.secondResponse.slice(7) + globalThis.firstResponse);
					continue;
				}
				if (!("id" in request)) continue;
				if (!initialized) {
					initialized = true;
					process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ready: true } }) + "\\n");
					continue;
				}
				const response = JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { method: request.method } }) + "\\n";
				if (request.method === "first") {
					globalThis.firstResponse = response;
					if (globalThis.secondResponse) {
						process.stdout.write(globalThis.secondResponse.slice(0, 7));
					}
				} else {
					globalThis.secondResponse = response;
					if (globalThis.firstResponse) {
						process.stdout.write(globalThis.secondResponse.slice(0, 7));
					}
				}
			}
		});
	`);
	const fragmentAbort = new AbortController();
	const fragments = on(client.child.stdout, "data", { signal: fragmentAbort.signal });
	try {
		const fragmentRead = (async () => {
			let fragment = "";
			for await (const [chunk] of fragments) {
				fragment += chunk.toString();
				if (fragment.length >= 7) return fragment;
			}
			return fragment;
		})();
		const first = client.request("first", {});
		const second = client.request("second", {});
		const responses = Promise.allSettled([first, second]);
		const fragment = await timeout(fragmentRead, "first response fragment");
		assert.equal(fragment, '{"jsonr');
		assert.equal(client.dead, null);
		assert.equal(client.pending.size, 2);
		client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "finish-fragments" })}\n`);
		assert.deepEqual(await timeout(responses, "fragmented responses"), [
			{ status: "fulfilled", value: { method: "first" } },
			{ status: "fulfilled", value: { method: "second" } },
		]);
		assert.equal(client.pending.size, 0);
		assert.equal(client.nextId, 4);
	} finally {
		fragmentAbort.abort();
		client.stop();
	}
});

test("#given multiple pending calls #when the child dies abruptly #then all calls reject and later calls fail", async () => {
	const client = await startFixture(`
		let initialized = false;
		let buffer = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			buffer += chunk;
			let index;
			while ((index = buffer.indexOf("\\n")) >= 0) {
				const request = JSON.parse(buffer.slice(0, index));
				buffer = buffer.slice(index + 1);
				if (!("id" in request)) continue;
				if (!initialized) {
					initialized = true;
					process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ready: true } }) + "\\n");
					continue;
				}
				process.exit(9);
			}
		});
	`);
	try {
		const dead = new Promise((resolve) => client.child.once("exit", resolve));
		const pending = [client.request("first", {}), client.request("second", {})];
		const settled = Promise.allSettled(pending);
		await timeout(dead, "abrupt child exit");
		const results = await settled;
		assert.equal(results.length, 2);
		assert.ok(results.every((result) => result.status === "rejected"));
		assert.equal(client.pending.size, 0);
		await assert.rejects(client.callTool("later", {}), /server-exit:/);
	} finally {
		client.stop();
	}
});
