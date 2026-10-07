import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import { FAKE_TOOLS } from "../test/support/fake-apple-cua.js";
import type { CallOptions } from "./mcp-bridge.js";
import { mcpToolDefinitions } from "./mcp-tools.js";
import type { ExtensionContext } from "./pi/index.js";

// The bridged tools never read their pi context.
const context = {} as ExtensionContext;

function stubBridge(answer: CallToolResult, progress: readonly string[] = []) {
	return {
		callTool: vi.fn(async (_name: string, _args: Readonly<Record<string, unknown>>, options?: CallOptions) => {
			for (const message of progress) {
				options?.onProgress?.(message);
			}
			return answer;
		}),
	};
}

describe("#given the server's tools/list #when pi tools are built #then each mirrors its MCP tool", () => {
	it("keeps the name, description and JSON Schema, without the $schema dialect marker", () => {
		const definitions = mcpToolDefinitions(FAKE_TOOLS, stubBridge({ content: [] }));
		const click = definitions.find((definition) => definition.name === "click");
		const source = FAKE_TOOLS.find((tool) => tool.name === "click");

		expect(definitions.map((definition) => definition.name)).toEqual(FAKE_TOOLS.map((tool) => tool.name));
		expect(click?.description).toBe(source?.description);
		expect(click?.executionMode).toBe("sequential");
		expect(JSON.parse(JSON.stringify(click?.parameters))).toEqual({
			type: "object",
			properties: source?.inputSchema.properties,
			required: ["app", "observation_token"],
		});
	});
});

describe("#given a bridged tool #when pi executes it #then the call goes to tools/call and the answer comes back", () => {
	it("forwards the arguments and returns the image and text in order", async () => {
		const bridge = stubBridge({
			content: [
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
				{ type: "text", text: '{"observation_token":"t1"}' },
			],
		});
		const [getAppState] = mcpToolDefinitions(
			FAKE_TOOLS.filter((tool) => tool.name === "get_app_state"),
			bridge,
		);

		const result = await getAppState?.execute("call-1", { app: "TextEdit" }, undefined, undefined, context);

		expect(bridge.callTool).toHaveBeenCalledWith("get_app_state", { app: "TextEdit" }, expect.any(Object));
		expect(result?.content).toEqual([
			{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			{ type: "text", text: '{"observation_token":"t1"}' },
		]);
	});

	it("streams progress notifications as partial results", async () => {
		const [listApps] = mcpToolDefinitions(
			FAKE_TOOLS.filter((tool) => tool.name === "list_apps"),
			stubBridge({ content: [{ type: "text", text: "[]" }] }, ["step 1 of 2"]),
		);
		const onUpdate = vi.fn();

		await listApps?.execute("call-1", {}, undefined, onUpdate, context);

		expect(onUpdate).toHaveBeenCalledWith({ content: [{ type: "text", text: "step 1 of 2" }], details: undefined });
	});

	it("throws a refusal so pi marks the call failed", async () => {
		const [click] = mcpToolDefinitions(
			FAKE_TOOLS.filter((tool) => tool.name === "click"),
			stubBridge({ isError: true, content: [{ type: "text", text: '{"reason":"stale-observation-token"}' }] }),
		);

		await expect(
			click?.execute("call-1", { app: "TextEdit", observation_token: "old" }, undefined, undefined, context),
		).rejects.toThrow(/stale-observation-token/);
	});
});
