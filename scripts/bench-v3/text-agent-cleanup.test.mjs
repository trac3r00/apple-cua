import assert from "node:assert/strict";
import test from "node:test";
import { textAgentCleanup } from "./text-agent-cleanup.mjs";

test("#given destroyed owned documents and retained offscreen WindowServer entries #when checking cleanup #then no document remains", () => {
	assert.equal(textAgentCleanup(0, 0, [{ title: "document.txt", onScreen: false }]).leftover, false);
});

test("#given an owned document remains but is hidden #when checking cleanup #then retain the leftover", () => {
	assert.equal(textAgentCleanup(1, 0, []).leftover, true);
	assert.equal(textAgentCleanup(0, 1, []).leftover, true);
});

test("#given unreadable or invalid document counts #when checking cleanup #then refuse to claim closure", () => {
	for (const count of [Number.NaN, -1, 0.5]) assert.throws(() => textAgentCleanup(count, 0, []), /invalid/);
});
