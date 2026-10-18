import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("#given overlapping raw cohorts #when merging paired analysis #then refuses ambiguous block identities", () => {
	const directory = mkdtempSync(join(tmpdir(), "cua-merge-test-"));
	try {
		const raw = join(directory, "raw.json");
		writeFileSync(raw, JSON.stringify({ results: [{ route: "apple", scenario: "task", iteration: 1, pass: true }] }));
		assert.throws(
			() =>
				execFileSync(
					process.execPath,
					[fileURLToPath(new URL("./save-analysis.mjs", import.meta.url)), join(directory, "out.json"), raw, raw],
					{ timeout: 10000, stdio: "pipe" },
				),
			/duplicate paired identity/,
		);
	} finally {
		rmSync(directory, { recursive: true });
	}
});
