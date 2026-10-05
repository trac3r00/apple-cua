import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";
import { IPHONE_TOOL_NAMES, LEAN_TOOL_NAMES, TOOL_NAMES, toolNamesFor } from "./tool-names.js";
import type { McpServerOptions } from "./toolset.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

async function connect(serverOptions?: McpServerOptions) {
	const harness = await createHarness(undefined, undefined, undefined, serverOptions ? { serverOptions } : undefined);
	closeHarness = harness.close;
	const listed = await harness.client.listTools();
	return { harness, names: listed.tools.map((tool) => tool.name).sort() };
}

function mentionedTools(instructions: string): string[] {
	return TOOL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(instructions));
}

describe("lean toolset #given toolset=lean #when tools are listed #then exactly the lean tools are registered", () => {
	it("registers the lean list, serves skills, and names only registered tools in its instructions", async () => {
		const { harness, names } = await connect({ toolset: "lean", iphone: false });

		expect(names).toEqual([...LEAN_TOOL_NAMES].sort());
		expect(names).toHaveLength(9);
		const instructions = harness.client.getInstructions() ?? "";
		const mentioned = mentionedTools(instructions);
		for (const name of mentioned) {
			expect(LEAN_TOOL_NAMES).toContain(name);
		}
		expect(mentioned).toEqual(
			expect.arrayContaining(["get_app_state", "find_elements", "run_script", "verify_state"]),
		);
		const resources = await harness.client.listResources();
		expect(resources.resources.map((resource) => resource.uri)).toContain("skill://apple-cua/SKILL.md");
	});

	it("reports the toolset and the registered tool count from get_capabilities", async () => {
		const { harness } = await connect({ toolset: "lean", iphone: false });

		const report = jsonPayload(await harness.client.callTool({ name: "get_capabilities", arguments: {} }));

		expect(report["server"]).toMatchObject({ toolset: "lean", tools: LEAN_TOOL_NAMES.length });
	});
});

describe("full toolset #given the default #when tools are listed #then desktop tools are registered without iPhone", () => {
	it("names only registered tools in its instructions and reports the full count", async () => {
		const { harness, names } = await connect({ toolset: "full", iphone: false });

		expect(names).toEqual([...toolNamesFor("full", false)].sort());
		for (const name of mentionedTools(harness.client.getInstructions() ?? "")) {
			expect(names).toContain(name);
		}
		const report = jsonPayload(await harness.client.callTool({ name: "get_capabilities", arguments: {} }));
		expect(report["server"]).toMatchObject({ toolset: "full", tools: names.length });
	});
});

describe("iPhone opt-in #given the iphone option #when tools are listed #then ios_* tools appear only when enabled", () => {
	it("registers no ios_* tool by default", async () => {
		vi.stubEnv("APPLE_CUA_IPHONE", "");
		vi.stubEnv("APPLE_CUA_TOOLSET", "");
		const { names } = await connect();

		expect(names.filter((name) => name.startsWith("ios_"))).toEqual([]);
	});

	it("registers the 12 ios_* tools with the option, on the full and the lean toolset", async () => {
		const full = await connect({ toolset: "full", iphone: true });
		expect(full.names).toEqual([...toolNamesFor("full", true)].sort());
		expect(full.names.filter((name) => name.startsWith("ios_"))).toHaveLength(IPHONE_TOOL_NAMES.length);
		await closeHarness?.();
		closeHarness = undefined;

		const lean = await connect({ toolset: "lean", iphone: true });
		expect(lean.names).toEqual([...toolNamesFor("lean", true)].sort());
	});

	it("honours APPLE_CUA_IPHONE=1 and APPLE_CUA_TOOLSET=lean from the environment", async () => {
		vi.stubEnv("APPLE_CUA_IPHONE", "1");
		vi.stubEnv("APPLE_CUA_TOOLSET", "lean");
		const { names } = await connect();

		expect(names).toEqual([...toolNamesFor("lean", true)].sort());
	});
});

describe("unknown toolset #given an unrecognised APPLE_CUA_TOOLSET #when the server starts #then it falls back to full and says so once", () => {
	it("serves the full toolset and warns on stderr a single time", async () => {
		vi.stubEnv("APPLE_CUA_IPHONE", "");
		vi.stubEnv("APPLE_CUA_TOOLSET", "tiny-unknown");
		const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		const first = await connect();
		await closeHarness?.();
		closeHarness = undefined;
		const second = await connect();

		expect(first.names).toEqual([...toolNamesFor("full", false)].sort());
		expect(second.names).toEqual(first.names);
		const warnings = write.mock.calls.filter(([chunk]) => String(chunk).includes("tiny-unknown"));
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0]?.[0])).toContain('using "full"');
	});
});
