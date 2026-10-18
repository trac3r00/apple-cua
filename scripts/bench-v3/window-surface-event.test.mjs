import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { subscribeSurface } from "./window-surface-event.mjs";

const helper = (program) => (_binary, args, options) => {
	assert.deepEqual(args, ["42", "7"]);
	return spawn(process.execPath, ["-e", program], options);
};

test("#given a subscribed surface observer #when completion arrives #then resolves exact identity signals", async () => {
	const observer = await subscribeSurface("unused", 42, 7, helper('console.log("SUBSCRIBED\\nREADY")'));
	await observer.ready;
});

test("#given an incomplete surface observer #when it exits #then does not hang or verify closure", async () => {
	await assert.rejects(subscribeSurface("unused", 42, 7, helper("process.exit(0)")), /incomplete/);
	const observer = await subscribeSurface("unused", 42, 7, helper('console.log("SUBSCRIBED")'));
	await assert.rejects(observer.ready, /incomplete/);
});
