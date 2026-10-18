import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { startDisturbance } from "./disturbance.mjs";

test("#given live activation #when trace receives event #then abort before final summary and retain it", async () => {
	const child = new EventEmitter();
	child.stdout = new PassThrough();
	child.stdin = new PassThrough();
	child.kill = () => undefined;
	const events = [];
	const controller = new AbortController();
	const starting = startDisturbance("fake", {
		spawnProcess: () => child,
		onDisturbance: (event) => {
			events.push(event);
			controller.abort();
		},
	});
	child.stdout.write('{"ready":true}\n');
	const trace = await starting;
	const event = { kind: "activation", ms: 115, bundle: "com.apple.TextEdit" };
	child.stdout.write(`${JSON.stringify({ disturbance: event })}\n`);
	assert.equal(controller.signal.aborted, true);
	assert.deepEqual(events, [event]);
	const stopping = trace.stop();
	child.stdout.write('{"summary":{"activations":[{"ms":115,"bundle":"com.apple.TextEdit"}]}}\n');
	assert.deepEqual((await stopping).activations, [{ ms: 115, bundle: "com.apple.TextEdit" }]);
	child.stdout.end();
	child.emit("close", 0);
});
