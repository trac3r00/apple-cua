import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { resultDirectory, textControlUnchanged } from "./run.mjs";

test("#given a relative result filename #when creating its directory #then it stays under the requested workspace", () => {
	assert.equal(resultDirectory(".bench/v3/relative.json"), resolve(".bench/v3"));
});

test("#given unchanged saved control bytes #when an open control has an unsaved edit #then it fails", () => {
	assert.equal(textControlUnchanged("other document unchanged", "unsaved wrong-window input", true), false);
	assert.equal(textControlUnchanged("other document unchanged", null, true), false);
	assert.equal(textControlUnchanged("other document unchanged", "other document unchanged", true), true);
	assert.equal(textControlUnchanged("changed saved bytes", "other document unchanged", true), false);
	assert.equal(textControlUnchanged("other document unchanged", null, false), true);
});
