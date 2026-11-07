import { describe, expect, it } from "bun:test";
import { type CliRunner, removeRenamedMcp } from "./plugin-clients.js";

describe("#given CLI-owned registrations #when the old product name is removed #then client-specific removal is used", () => {
	it.each([
		{ client: "claude", expected: ["mcp", "remove", "apple-cua", "--scope", "user"], input: undefined },
		{ client: "gemini", expected: ["mcp", "remove", "-s", "user", "apple-cua"], input: undefined },
		{ client: "hermes", expected: ["mcp", "remove", "apple-cua"], input: "Y\n" },
		{ client: "openclaw", expected: ["mcp", "unset", "apple-cua"], input: undefined },
	] as const)("$client follows its removal protocol", ({ client, expected, input }) => {
		const calls: { args: readonly string[]; input: string | undefined }[] = [];
		const run: CliRunner = (_command, args, _env, stdin) => {
			calls.push({ args, input: stdin });
			return { status: 0, stdout: "", stderr: "" };
		};
		removeRenamedMcp(client, client, {}, run);
		expect(calls).toEqual([{ args: expected, input }]);
	});

	it("reports removal failures instead of silently adding a duplicate server", () => {
		expect(() =>
			removeRenamedMcp("claude", "claude", {}, () => ({ status: 1, stdout: "", stderr: "denied" })),
		).toThrow("denied");
	});
});
