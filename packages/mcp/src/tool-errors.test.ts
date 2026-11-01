import { describe, expect, it } from "bun:test";
import { normalizeToolError } from "./tool-errors.js";

describe("tool error normalization", () => {
	it("#given a successful payload #when normalizing #then its object and fields are unchanged", () => {
		const result = { content: [{ type: "text" as const, text: '{"verified":false}' }] };
		expect(normalizeToolError(result)).toBe(result);
	});

	it("#given a post-dispatch observation failure #when normalizing #then retry is unsafe and evidence survives", () => {
		const result = normalizeToolError({
			content: [
				{ type: "text", text: '{"actionDispatched":true,"observationStatus":"error","error":"read failed"}' },
			],
		});
		const text = result.content[0];
		expect(result.isError).toBe(true);
		expect(text?.type === "text" && JSON.parse(text.text)).toMatchObject({
			ok: false,
			error: "read failed",
			actionDispatched: true,
			code: "POST_ACTION_ERROR",
			retry: "unsafe",
			disposition: { retry: "unsafe" },
		});
	});
});
