import assert from "node:assert/strict";
import test from "node:test";
import * as agents from "./agents.mjs";
import {
	AGENT_MODEL,
	AGENT_REASONING,
	AGENT_TIMEOUT_MS,
	buildAgentPrompt,
	matchedAgentModel,
	parseAgentTranscript,
} from "./agents.mjs";

test("#given the registered cross-app task #when configuring its isolated hand #then permits only its two apps without changing the default hand", () => {
	const bundles = ["com.apple.TextEdit", "com.apple.Safari"];
	const server = agents.agentServerSpecs("omo-apple", bundles)["apple-cua"];
	assert.equal(server.env.APPLE_CUA_ALLOWED_BUNDLE_IDS, bundles.join(","));
	assert.equal(server.env.APPLE_CUA_DELIVERY, "background");
	assert.equal(
		agents.agentServerSpecs("omo-apple")["apple-cua"].env.APPLE_CUA_ALLOWED_BUNDLE_IDS,
		"com.apple.finder,com.apple.TextEdit",
	);
	assert.equal(agents.agentServerSpecs("omo-cua", bundles)["apple-cua"], undefined);
});

test("#given cache writes in client usage #when parsing #then preserve usage scope without treating a turn as a request", () => {
	const usage = { input: 21, output: 7, cacheRead: 3, cacheWrite: 5 };
	const omo = parseAgentTranscript(
		"omo-apple",
		JSON.stringify({
			type: "message_end",
			message: { role: "assistant", model: "gpt-6-astra", usage, content: [] },
		}),
	);
	assert.deepEqual(omo.usageRecords, [{ scope: "assistant_message", model: "gpt-6-astra", usage }]);
	const codexUsage = { input_tokens: 44, output_tokens: 8 };
	const codex = parseAgentTranscript("codex-apple", JSON.stringify({ type: "turn.completed", usage: codexUsage }));
	assert.deepEqual(codex.usageRecords, [{ scope: "turn_aggregate", model: null, usage: codexUsage }]);
});

test("#given observed model identifiers #when matching registration #then rejects suffix aliases and preserves unknown", () => {
	assert.equal(matchedAgentModel(null), null);
	assert.equal(matchedAgentModel("gpt-6-astra"), true);
	assert.equal(matchedAgentModel("chatgpt-subscription/gpt-6-astra"), true);
	assert.equal(matchedAgentModel("different-gpt-6-astra"), false);
	assert.equal(matchedAgentModel("other-provider/gpt-6-astra"), false);
});

test("#given an attached browser task session #when building its route #then the exact session is passed", () => {
	const prompt = buildAgentPrompt("omo-attached-browser", "Fill Code", {
		sessionId: "test-session",
		browserInstanceId: "test-browser",
	});
	assert.ok(prompt.includes("test-session"));
	assert.ok(prompt.includes("test-browser"));
	assert.throws(() => buildAgentPrompt("omo-attached-browser", "Fill Code"), /session/);
});

test("#given registered agent configuration #when inspecting parameters #then model and budget match registration", () => {
	assert.equal(AGENT_MODEL, "gpt-6-astra");
	assert.equal(AGENT_REASONING, "high");
	assert.equal(AGENT_TIMEOUT_MS, 300_000);
});

test("#given an unknown route #when building its prompt or parsing output #then it fails explicitly", () => {
	assert.throws(() => buildAgentPrompt("other", "task"), /unknown agent route/);
	assert.throws(() => parseAgentTranscript("other", ""), /unknown agent route/);
});

test("#given OmO JSONL with reported usage #when parsing the final assistant message #then it preserves observed model, usage and result", () => {
	const transcript = [
		JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				provider: "chatgpt-subscription",
				model: "gpt-6-astra",
				usage: { input: 21, output: 7, cacheRead: 3, cost: { total: 0 } },
				content: [{ type: "text", text: "Task finished.\nRESULT: DONE" }],
			},
		}),
	].join("\n");
	assert.deepEqual(parseAgentTranscript("omo-apple", transcript), {
		usageRecords: [
			{
				scope: "assistant_message",
				model: "chatgpt-subscription/gpt-6-astra",
				usage: { input: 21, output: 7, cacheRead: 3, cost: { total: 0 } },
			},
		],
		answer: "Task finished.\nRESULT: DONE",
		model: "chatgpt-subscription/gpt-6-astra",
		inputTokens: 21,
		outputTokens: 7,
		cachedInputTokens: 3,
		costUsd: 0,
		toolCalls: 0,
		result: "DONE",
	});
});

test("#given OmO output without usage #when parsing #then token and cost fields remain unknown", () => {
	const parsed = parseAgentTranscript(
		"omo-cua",
		JSON.stringify({
			type: "message_end",
			message: { role: "assistant", model: "gpt-6-astra", content: [{ type: "text", text: "RESULT: NOT DONE" }] },
		}),
	);
	assert.equal(parsed.model, "gpt-6-astra");
	assert.equal(parsed.result, "NOT DONE");
	assert.equal(parsed.inputTokens, null);
	assert.equal(parsed.outputTokens, null);
	assert.equal(parsed.cachedInputTokens, null);
	assert.equal(parsed.costUsd, null);
});

test("#given Codex JSONL with a final agent message and usage #when parsing #then it reports only observed fields", () => {
	const transcript = [
		JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Completed.\nRESULT: DONE" } }),
		JSON.stringify({ type: "turn.completed", usage: { input_tokens: 44, output_tokens: 8 } }),
	].join("\n");
	assert.deepEqual(parseAgentTranscript("codex-apple", transcript), {
		usageRecords: [{ scope: "turn_aggregate", model: null, usage: { input_tokens: 44, output_tokens: 8 } }],
		answer: "Completed.\nRESULT: DONE",
		model: null,
		inputTokens: 44,
		outputTokens: 8,
		cachedInputTokens: null,
		costUsd: null,
		toolCalls: 0,
		result: "DONE",
	});
});

test("#given a non-final or malformed result line #when parsing #then it is not counted as a completion", () => {
	const parsed = parseAgentTranscript(
		"codex-native",
		JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "RESULT: DONE\nMore text." } }),
	);
	assert.equal(parsed.result, null);
	assert.equal(parseAgentTranscript("codex-cua", "RESULT: DONE trailing").result, null);
});
