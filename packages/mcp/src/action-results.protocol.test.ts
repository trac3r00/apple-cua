import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function imageBlocks(result: unknown): readonly unknown[] {
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		throw new Error("tool result content must be an array");
	}
	return result.content.filter(
		(item: unknown) => typeof item === "object" && item !== null && "type" in item && item.type === "image",
	);
}

describe("action result payload #given a dispatched action #when the caller does not ask for the image #then the answer stays text-only", () => {
	it("omits the post-action screenshot by default and returns it only on request", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const leanToken = await observe(harness);
		const lean = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: leanToken, element_index: "9" },
		});

		const optedInToken = await observe(harness);
		const withImage = await harness.client.callTool({
			name: "click",
			arguments: {
				app: "Finder",
				observation_token: optedInToken,
				element_index: "9",
				include_screenshot: true,
			},
		});

		expect(imageBlocks(lean)).toHaveLength(0);
		expect(jsonPayload(lean)).toMatchObject({ actionDispatched: true });
		expect(imageBlocks(withImage)).toHaveLength(1);
	});
});
