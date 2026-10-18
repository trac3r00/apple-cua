import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const missingTrace of [false, true]) {
	test(`#given ${missingTrace ? "missing" : "complete"} trace metrics #when verifying an extension #then safety is not inferred`, () => {
		const directory = mkdtempSync(join(tmpdir(), "cua-extension-test-"));
		try {
			const file = join(directory, "raw.json");
			writeFileSync(
				file,
				JSON.stringify({
					finished_at: "2026-10-11T00:00:00Z",
					results: ["apple", "cua"].map((route) => ({
						route,
						scenario: "textedit-two-windows",
						iteration: 31,
						pass: route === "apple",
						focus_disturbance: false,
						pointer_disturbance: false,
						cleanup: { attempted: true, leftover: [] },
						disturbance_trace: {
							...(missingTrace ? {} : { max_cursor_px: 0 }),
							activations: [],
						},
					})),
				}),
			);
			const verify = () =>
				execFileSync(
					process.execPath,
					[fileURLToPath(new URL("./verify-text-extension.mjs", import.meta.url)), file, "31", "31"],
					{ timeout: 10000, encoding: "utf8", stdio: "pipe" },
				);
			if (missingTrace) assert.throws(verify, /disturbance or missing trace/);
			else {
				const result = JSON.parse(verify());
				assert.equal(result.verified_cleanups, 2);
				assert.equal(result.counts.apple.completed, 1);
				assert.equal(result.counts.cua.completed, 0);
				assert.match(result.sha256, /^[a-f0-9]{64}$/);
			}
		} finally {
			rmSync(directory, { recursive: true });
		}
	});
}
