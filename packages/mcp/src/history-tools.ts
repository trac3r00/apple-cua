import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { textResult } from "./tool-result.js";

const behavior = z.enum(["observe", "do_not_observe"]);

const settingsSchema = z.object({
	defaultApplicationBehavior: behavior,
	defaultURLBehavior: behavior,
	observePrivateBrowsing: z.boolean(),
	rules: z
		.array(
			z.discriminatedUnion("scope", [
				z.object({ scope: z.literal("app"), bundleID: z.string().min(1), behavior }),
				z.object({ scope: z.literal("url"), urlDomain: z.string().min(1), behavior }),
			]),
		)
		.readonly(),
});

export type HistoryObservationSettings = z.infer<typeof settingsSchema>;

export interface HistoryStatus {
	readonly state: "running" | "paused" | "stopped";
	readonly eventStreamRootPath: string;
	readonly summariesPath: string;
	readonly retentionHours: number;
	readonly currentSegmentId?: string;
}

export interface HistoryToolSource {
	status(): HistoryStatus | Promise<HistoryStatus>;
	getSettings(): HistoryObservationSettings | Promise<HistoryObservationSettings>;
	updateSettings(
		settings: HistoryObservationSettings,
	): HistoryObservationSettings | Promise<HistoryObservationSettings>;
	pause(): void | Promise<void>;
	resume(): void | Promise<void>;
}

export function registerHistoryTools(server: McpServer, source: HistoryToolSource): void {
	server.registerTool(
		"cua_history_status",
		{
			description: "Get cua-history status and the paths to recent activity segments and memory summaries.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async () => textResult(JSON.stringify(await source.status())),
	);

	server.registerTool(
		"cua_history_get_settings",
		{
			description:
				"Get all cua-history observation settings. Call this immediately before cua_history_update_settings so unchanged fields can be preserved.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async () => textResult(JSON.stringify(await source.getSettings())),
	);

	server.registerTool(
		"cua_history_update_settings",
		{
			description:
				"Replace all cua-history observation settings. The update replaces the whole document, so preserve every field and rule the user did not ask to change by first calling cua_history_get_settings.",
			inputSchema: settingsSchema,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (input) => textResult(JSON.stringify(await source.updateSettings(input))),
	);

	server.registerTool(
		"cua_history_pause",
		{
			description: "Temporarily pause cua-history without disabling it. The current segment is retained.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async () => {
			await source.pause();
			return textResult(JSON.stringify(await source.status()));
		},
	);

	server.registerTool(
		"cua_history_resume",
		{
			description: "Resume a paused cua-history recorder.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: false, destructiveHint: false },
		},
		async () => {
			await source.resume();
			return textResult(JSON.stringify(await source.status()));
		},
	);
}
