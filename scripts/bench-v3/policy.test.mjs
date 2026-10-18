import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquirePolicyLock, policyOutcome } from "./policy-run.mjs";

test("#given another fixture owns the shared lock #when policy trials start #then they refuse overlap", () => {
	const root = mkdtempSync(join(tmpdir(), "policy-lock-test-"));
	const path = join(root, ".run.lock");
	const owner = openSync(path, "wx");
	try {
		assert.throws(() => acquirePolicyLock(root), { code: "EEXIST" });
	} finally {
		closeSync(owner);
		rmSync(path);
	}
	try {
		closeSync(acquirePolicyLock(root));
		assert.throws(() => acquirePolicyLock(root), { code: "EEXIST" });
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("#given explicit policy refusal #when live document is unchanged #then denial passes", () => {
	assert.equal(
		policyOutcome({ isError: true, error: "TextEdit needs your approval" }, "control", "control").pass,
		true,
	);
});

test("#given refusal text #when input still lands #then denial fails", () => {
	const result = policyOutcome({ error: "permission_denied" }, "control", "changed");
	assert.equal(result.pass, false);
	assert.equal(result.input_landed, true);
});

test("#given timeout or unrelated failure #when document is unchanged #then it is not proof of denial", () => {
	assert.equal(policyOutcome(null, "control", "control", "timeout").pass, false);
	assert.equal(policyOutcome({ isError: true, error: "unknown tool" }, "control", "control").pass, false);
	assert.equal(policyOutcome({ ok: true }, "control", "control").pass, false);
	assert.equal(policyOutcome({ ok: true, advice: "TextEdit needs your approval" }, "control", "control").pass, false);
});
