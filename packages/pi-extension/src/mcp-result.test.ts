import { describe, expect, it } from "vitest";

import { agentToolResult, resultPayload } from "./mcp-result.js";

describe("#given an apple-cua-mcp answer #when converted for pi #then text and images pass through in order", () => {
	it("keeps an observation's window image ahead of its state text", () => {
		const result = agentToolResult({
			content: [
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/jpeg" },
				{ type: "text", text: '{"app":"TextEdit","observation_token":"t1"}' },
			],
		});

		expect(result).toEqual({
			content: [
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/jpeg" },
				{ type: "text", text: '{"app":"TextEdit","observation_token":"t1"}' },
			],
			details: undefined,
		});
	});

	it("names content pi cannot carry instead of dropping it", () => {
		const result = agentToolResult({
			content: [
				{ type: "audio", data: "AAAA", mimeType: "audio/wav" },
				{ type: "resource", resource: { uri: "skill://apple-cua/SKILL.md", text: "# apple-cua" } },
				{ type: "resource", resource: { uri: "file:///tmp/shot.png", blob: "AAAA", mimeType: "image/png" } },
				{ type: "resource_link", uri: "skill://apple-cua/references/usage.md", name: "usage" },
			],
		});

		expect(result.content.map((item) => item.type)).toEqual(["text", "text", "text", "text"]);
		expect(result.content[1]).toEqual({ type: "text", text: "# apple-cua" });
	});

	it("answers structured-only content as its JSON", () => {
		expect(agentToolResult({ content: [], structuredContent: { ok: true } }).content).toEqual([
			{ type: "text", text: '{"ok":true}' },
		]);
	});
});

describe("#given a refusal #when converted for pi #then it is thrown so pi reports a failed call", () => {
	it("throws the server's own reason", () => {
		const refusal = '{"reason":"app-not-approved","message":"Nothing was dispatched."}';

		expect(() => agentToolResult({ isError: true, content: [{ type: "text", text: refusal }] })).toThrow(refusal);
	});

	it("still throws when the refusal carries no text", () => {
		expect(() => agentToolResult({ isError: true, content: [] })).toThrow(/refused the call/);
	});
});

describe("#given an answer's first text #when read as a payload #then only a JSON object counts", () => {
	it.each([
		['{"observation_token":"t1"}', { observation_token: "t1" }],
		["[1,2]", undefined],
		["not json", undefined],
	])("reads %s", (text, expected) => {
		expect(resultPayload({ content: [{ type: "text", text }] })).toEqual(expected);
	});
});
