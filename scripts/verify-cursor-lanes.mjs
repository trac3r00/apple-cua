import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Run against the freshly built native helper. Each state response is a barrier
// after all preceding commands; no timer-based settling is used.
const binary =
	process.env.APPLE_CUA_QA_OVERLAY ??
	fileURLToPath(new URL("../packages/core/native/cursor-overlay", import.meta.url));
const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: child.stdout });
const pending = [];
const failure = new Promise((_, reject) => {
	child.once("error", reject);
	child.once("exit", (code) => reject(new Error(`overlay exited before verification: ${code}`)));
});
// Attach immediately, including when a child exits before the first query.
failure.catch(() => undefined);
lines.on("line", (line) => pending.shift()?.resolve(JSON.parse(line)));

async function state(pid) {
	let resolve;
	const response = new Promise((done) => {
		resolve = done;
	});
	pending.push({ resolve });
	child.stdin.write(`pid ${pid} state\n`);
	let timeout;
	try {
		return await Promise.race([
			response,
			failure,
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error("state response exceeded 5 seconds")), 5000);
			}),
		]);
	} finally {
		clearTimeout(timeout);
	}
}

try {
	child.stdin.write("pid 101 set-direct 600 400\npid 202 set-direct 900 600\n");
	const first = await state(101);
	const second = await state(202);
	assert.deepEqual([first.x, first.y], [600, 400]);
	assert.deepEqual([second.x, second.y], [900, 600]);
	child.stdin.write("pid 101 set-direct 650 450\n");
	const moved = await state(101);
	const unchanged = await state(202);
	assert.deepEqual([moved.x, moved.y], [650, 450]);
	assert.deepEqual([unchanged.x, unchanged.y], [900, 600]);
	const screenshot = process.argv[2];
	if (screenshot !== undefined) {
		await promisify(execFile)("/usr/sbin/screencapture", ["-x", screenshot]);
	}
	child.stdin.write("pid 101 hide\n");
	const hidden = await state(101);
	const visible = await state(202);
	assert.equal(hidden.shown, false);
	assert.equal(visible.shown, true);
	const result = { verified: true, first, second, moved, unchanged, hidden, visible, screenshot };
	process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
	lines.close();
	child.stdin.end();
}
