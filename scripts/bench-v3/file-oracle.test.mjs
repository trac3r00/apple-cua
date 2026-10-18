import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expectFile } from "./file-oracle.mjs";

test("#given subscribed file oracle #when atomic save replaces inode #then exact bytes pass", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cua-oracle-"));
	try {
		const target = join(dir, "target.txt");
		writeFileSync(target, "old");
		const oracle = await expectFile(target, "marker");
		writeFileSync(join(dir, "new.txt"), "marker");
		renameSync(join(dir, "new.txt"), target);
		assert.deepEqual(await oracle.result, { pass: true });
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("#given wrong bytes #when stopped #then no false completion", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cua-oracle-"));
	try {
		const target = join(dir, "target.txt");
		writeFileSync(target, "marker\n");
		const oracle = await expectFile(target, "marker");
		oracle.cancel();
		assert.deepEqual(await oracle.result, { pass: false, cancelled: true });
	} finally {
		rmSync(dir, { recursive: true });
	}
});
