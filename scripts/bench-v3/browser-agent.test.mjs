import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentTranscript } from "./agents.mjs";
import { BROWSER_TASKS, browserTaskPass, browserTaskPrompt, recordBrowserTrace } from "./browser-agent-run.mjs";

test("#given a terminated sampler #when finalizing its attempt #then retain failure and unknown disturbance", async () => {
	const failure = new Error("sampler terminated");
	const row = { pass: false };
	assert.equal(
		await recordBrowserTrace(row, {
			async stop() {
				throw failure;
			},
		}),
		false,
	);
	assert.equal(row.disturbance_error, String(failure));
	assert.equal(row.pass, false);
	assert.equal(row.focus_disturbance, undefined);
	assert.equal(row.pointer_disturbance, undefined);
});

test("#given a completed sampler #when finalizing its attempt #then retain observed disturbance", async () => {
	const summary = { activations: ["com.google.Chrome"], max_cursor_px: 3 };
	const row = {};
	assert.equal(await recordBrowserTrace(row, { stop: async () => summary }), true);
	assert.equal(row.disturbance_trace, summary);
	assert.equal(row.focus_disturbance, true);
	assert.equal(row.pointer_disturbance, true);
});

test("browser task predicates verify independent page state", () => {
	assert.equal(browserTaskPass("form", { field: "Bench-v2 marker 8c52" }, ""), true);
	assert.equal(browserTaskPass("form", { field: "wrong" }, "RESULT: DONE"), false);
	assert.equal(browserTaskPass("scroll-link", { hash: "#destination" }, ""), true);
	assert.equal(browserTaskPass("scroll-link", { hash: "" }, ""), false);
	assert.equal(browserTaskPass("injection", { field: "Bench-v2 marker 8c52", forbidden: 0 }, ""), true);
	assert.equal(browserTaskPass("injection", { field: "Bench-v2 marker 8c52", forbidden: 1 }, ""), false);
});

test("unknown task is rejected and task page URL is included", () => {
	assert.throws(() => browserTaskPass("other", {}, ""), /unknown browser task/);
	assert.throws(() => browserTaskPrompt("other", "http://127.0.0.1/"), /unknown browser task/);
	assert.match(browserTaskPrompt("form", "http://127.0.0.1:9/page?x=1"), /http:\/\/127\.0\.0\.1:9\/page\?x=1/);
	assert.deepEqual(Object.keys(BROWSER_TASKS), ["form", "scroll-link", "injection"]);
});

test("agent RESULT line parsing supports every configured route", () => {
	for (const route of ["omo-apple", "omo-cua", "omo-native", "codex-native", "codex-apple", "codex-cua"]) {
		let transcript;
		if (route.startsWith("omo-")) {
			transcript = JSON.stringify({
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: "RESULT: DONE" }] },
			});
		} else {
			transcript = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "RESULT: DONE" } });
		}
		assert.equal(parseAgentTranscript(route, transcript).result, "DONE");
	}
});
