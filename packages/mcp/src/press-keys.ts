import {
	type ComputerInterface,
	type KeySequenceEntry,
	type KeySequenceOptions,
	pressKeySequence,
	resolveAppPid,
	withTargetedApp,
} from "@macos-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { ToolResult } from "./tool-result.js";

const keySequenceEntrySchema = z.union([
	z.string().min(1),
	z.object({
		key: z.string().min(1),
		hold_seconds: z.number().nonnegative().optional(),
	}),
]);

const pressKeysSchema = z.object({
	app: z.string().min(1),
	keys: z.array(keySequenceEntrySchema).min(1),
	hold_seconds: z.number().nonnegative().optional(),
	interval_seconds: z.number().nonnegative().optional(),
});

export function registerPressKeysTool(
	server: McpServer,
	computer: ComputerInterface,
	actionComplete: () => ToolResult,
): void {
	server.registerTool(
		"press_keys",
		{
			description: "Press keys or key-combinations in order, optionally holding each key and waiting between keys.",
			inputSchema: pressKeysSchema,
		},
		async ({ app, keys, hold_seconds, interval_seconds }): Promise<ToolResult> => {
			const targetPid = await resolveAppPid(computer, app);
			await withTargetedApp(computer, targetPid, async () => {
				await pressKeySequence(
					computer,
					keys.map(keySequenceEntryFromInput),
					keySequenceOptions(hold_seconds, interval_seconds),
				);
			});
			return actionComplete();
		},
	);
}

function keySequenceEntryFromInput(input: z.infer<typeof keySequenceEntrySchema>): KeySequenceEntry {
	if (typeof input === "string") {
		return { key: input };
	}
	return keySequenceEntry(input.key, input.hold_seconds);
}

function keySequenceEntry(key: string, holdSeconds: number | undefined): KeySequenceEntry {
	if (holdSeconds === undefined) {
		return { key };
	}
	return { key, holdSeconds };
}

function keySequenceOptions(
	holdSeconds: number | undefined,
	intervalSeconds: number | undefined,
): KeySequenceOptions | undefined {
	if (holdSeconds !== undefined && intervalSeconds !== undefined) {
		return { holdSeconds, intervalSeconds };
	}
	if (holdSeconds !== undefined) {
		return { holdSeconds };
	}
	if (intervalSeconds !== undefined) {
		return { intervalSeconds };
	}
	return undefined;
}
