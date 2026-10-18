import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cancellationFixtureDirectory } from "./cancellation-fixture.mjs";

test("#given an aliased fixture directory #when binding cleanup #then its path matches the canonical document", () => {
	const root = mkdtempSync(join(tmpdir(), "cancel-path-test-"));
	try {
		const alias = `${root}-alias`;
		symlinkSync(root, alias);
		try {
			assert.equal(cancellationFixtureDirectory(alias), realpathSync(root));
		} finally {
			rmSync(alias);
		}
	} finally {
		rmSync(root, { recursive: true });
	}
});
