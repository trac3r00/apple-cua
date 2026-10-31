import { afterEach, describe, expect, it } from "bun:test";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function textBlocks(result: unknown): unknown[] {
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		throw new Error("tool result content must be an array");
	}
	return result.content.flatMap((item: unknown) =>
		typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item
			? [JSON.parse(String(item.text))]
			: [],
	);
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected an object");
	}
	return Object.fromEntries(Object.entries(value));
}

describe("get_capabilities #given a client that names itself in initialize #when read #then the host harness is reported from clientInfo", () => {
	it.each([
		["claude-code", "claude-code"],
		["codex-mcp-client", "codex"],
		["apple-cua-pi-extension", "pi"],
	])("reports %s as %s", async (clientName, host) => {
		const harness = await createHarness(undefined, undefined, undefined, {
			clientInfo: { name: clientName, version: "9.9.9" },
		});
		closeHarness = harness.close;

		const report = jsonPayload(await harness.client.callTool({ name: "get_capabilities", arguments: {} }));
		const reported = record(report["host"]);

		expect(reported["name"]).toBe(host);
		expect(reported["source"]).toBe("client_info");
		expect(reported["clientName"]).toBe(clientName);
		expect(record(reported["workers"])["host"]).toBe(host);
	});
});

describe("manage_workers #given a detected harness and background delivery #when two apps are assigned #then the answer says how to spawn concurrent workers there", () => {
	it("attaches spawn guidance for the connected host", async () => {
		const harness = await createHarness(undefined, undefined, undefined, {
			clientInfo: { name: "claude-code", version: "1.0.0" },
		});
		closeHarness = harness.close;
		harness.computer.delivery = "background";

		const result = await harness.client.callTool({
			name: "manage_workers",
			arguments: {
				op: "assign",
				assignments: [
					{ worker_id: "w1", app: "Finder", task: "read Finder" },
					{ worker_id: "w2", app: "Other", task: "read Other" },
				],
			},
		});

		expect(result.isError).not.toBe(true);
		const spawn = textBlocks(result)
			.map((block) => (typeof block === "object" && block !== null && "spawn" in block ? block.spawn : undefined))
			.find((value) => value !== undefined);
		expect(record(spawn)["host"]).toBe("claude-code");
		expect(record(spawn)["concurrent"]).toBe(true);
	});
});
