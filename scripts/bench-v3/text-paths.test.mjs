import assert from "node:assert/strict";
import test from "node:test";
import { textDocumentPaths } from "./run.mjs";

test("#given a canonical fixture path #when selecting its document #then both macOS aliases are eligible", () => {
	assert.deepEqual(textDocumentPaths("/private/tmp/cua-bench/document.txt"), [
		"/private/tmp/cua-bench/document.txt",
		"/tmp/cua-bench/document.txt",
	]);
});
