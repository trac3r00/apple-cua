import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveAgentLogs } from "./archive-agent-logs.mjs";

test("#given restart removed the temporary agent root #when retaining evidence #then absent logs are explicit", () => {
	const root = mkdtempSync(join(tmpdir(), "agent-archive-missing-test-"));
	const missingRoot = join(root, "removed-agents");
	try {
		const manifest = archiveAgentLogs(
			[{ agent: { stdoutPath: join(missingRoot, "trial", "stdout.raw") } }],
			join(root, "archive"),
			missingRoot,
		);
		assert.equal(manifest[0].stdoutPath.missing, true);
		assert.equal(manifest[0].stdoutPath.source, join(missingRoot, "trial", "stdout.raw"));
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("#given completed agent logs and missing telemetry #when archiving #then bytes and missing evidence survive", () => {
	const root = mkdtempSync(join(tmpdir(), "agent-archive-test-"));
	const workspace = join(root, "agents", "trial");
	mkdirSync(workspace, { recursive: true });
	const stdoutPath = join(workspace, "stdout.raw");
	writeFileSync(stdoutPath, "raw terminal evidence\n");
	const rows = [{ agent: { stdoutPath, stderrPath: join(workspace, "stderr.raw") } }, { fixture_failed: true }];
	const snapshot = structuredClone(rows);
	try {
		const manifest = archiveAgentLogs(rows, join(root, "archive"), join(root, "agents"));
		assert.equal(readFileSync(manifest[0].stdoutPath.archived, "utf8"), "raw terminal evidence\n");
		assert.match(manifest[0].stdoutPath.sha256, /^[a-f0-9]{64}$/);
		assert.equal(manifest[0].stderrPath.missing, true);
		assert.equal(manifest[0].driverLog.missing, true);
		assert.equal(manifest[1].stdoutPath.missing, true);
		assert.deepEqual(rows, snapshot);
		assert.throws(() => archiveAgentLogs(rows, join(root, "archive"), join(root, "agents")), { code: "EEXIST" });
		assert.throws(
			() =>
				archiveAgentLogs(
					[{ agent: { stdoutPath: join(root, "outside") } }],
					join(root, "bad"),
					join(root, "agents"),
				),
			/outside agent root/,
		);
		symlinkSync(stdoutPath, join(workspace, "redirected.raw"));
		assert.throws(
			() =>
				archiveAgentLogs(
					[{ agent: { stdoutPath: join(workspace, "redirected.raw") } }],
					join(root, "redirected-archive"),
					join(root, "agents"),
				),
			/redirected agent log refused/,
		);
	} finally {
		rmSync(root, { recursive: true });
	}
});
