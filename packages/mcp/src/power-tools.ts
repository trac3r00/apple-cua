import { invokeMenu, readClipboard, setWindowFrame, writeClipboard } from "@macos-cua/core";
import type { GuardedComputerInterface, InputObservation, Rect } from "@macos-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { GuardedSession } from "./guarded-session.js";
import { type ToolResult, textResult } from "./tool-result.js";

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false } as const;
const MUTATION_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true } as const;

const mutationBase = {
	app: z.string().min(1),
	observation_token: z.string().min(1),
	full_state: z.boolean().optional(),
};

const invokeMenuSchema = z.object({
	...mutationBase,
	path: z.array(z.string()).min(1).max(16),
});

const setWindowFrameSchema = z.object({
	...mutationBase,
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().positive().finite(),
	height: z.number().positive().finite(),
});

const clipboardReadSchema = z.object({});
const clipboardWriteSchema = z
	.object({
		...mutationBase,
		text: z.string().optional(),
		image_path: z.string().optional(),
		file_path: z.string().optional(),
	})
	.refine(
		(input) => [input.text, input.image_path, input.file_path].filter((value) => value !== undefined).length === 1,
		{
			message: "provide exactly one of text, image_path, or file_path",
		},
	);

interface PowerComputerExtensions {
	invokeMenu?(
		pid: number,
		path: readonly string[],
	): Promise<{ readonly resolvedPath: readonly string[]; readonly action: string }>;
	setWindowFrame?(
		pid: number,
		windowId: number,
		frame: Rect,
	): Promise<{
		readonly requested: Rect;
		readonly applied: Rect | null;
		readonly verified: boolean;
		readonly attempts: number;
	}>;
	readClipboard?(): ReturnType<typeof readClipboard>;
	writeClipboard?(input: Parameters<typeof writeClipboard>[0]): ReturnType<typeof writeClipboard>;
}

type PowerComputer = GuardedComputerInterface & PowerComputerExtensions;

export function registerPowerTools(
	server: McpServer,
	session: GuardedSession,
	computer: GuardedComputerInterface,
): void {
	const powerComputer: PowerComputer = computer;

	server.registerTool(
		"invoke_menu",
		{
			description:
				"Resolve an exact live native application-menu path and invoke it without pixel fallback. Missing, ambiguous, disabled, or unsupported hops fail closed. Requires a one-use observation_token for the target app and window.",
			inputSchema: invokeMenuSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			let report: Awaited<ReturnType<typeof invokeMenu>> | undefined;
			const result = await session.mutate(
				input.observation_token,
				input.app,
				() => undefined,
				async (targetPid) => {
					report = await (powerComputer.invokeMenu?.(targetPid, input.path) ?? invokeMenu(targetPid, input.path));
					return { route: "accessibility", delivery: "background" } as const;
				},
				{ fullState: input.full_state === true },
			);
			return appendReport(result, "invokeMenu", report);
		},
	);

	server.registerTool(
		"set_window_frame",
		{
			description:
				"Set the observed top-level window's exact desktop geometry, then independently verify the applied frame through WindowServer within 2 points. Requires a one-use observation_token.",
			inputSchema: setWindowFrameSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			let report: Awaited<ReturnType<typeof setWindowFrame>> | undefined;
			const requested = { x: input.x, y: input.y, width: input.width, height: input.height };
			const result = await session.mutate(
				input.observation_token,
				input.app,
				() => undefined,
				async (targetPid, observation) => {
					report = await setFrame(powerComputer, targetPid, observation, requested);
					return { route: "synthetic_events", delivery: "background" } as const;
				},
				{ fullState: input.full_state === true },
			);
			return appendReport(result, "setWindowFrame", report);
		},
	);

	server.registerTool(
		"clipboard_read",
		{
			description:
				"Read the system clipboard's available pasteboard types and any plain text, image data, or file URL content. Clipboard content is privacy-sensitive.",
			inputSchema: clipboardReadSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async () => textResult(JSON.stringify(powerComputer.readClipboard?.() ?? readClipboard(), null, 2)),
	);

	server.registerTool(
		"clipboard_write",
		{
			description:
				"Overwrite the user's system clipboard with exactly one plain-text value, image from an absolute existing path, or file URL from an absolute existing path. Requires a one-use observation_token and returns fresh target-app state.",
			inputSchema: clipboardWriteSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			let report: ReturnType<typeof writeClipboard> | undefined;
			const result = await session.mutate(
				input.observation_token,
				input.app,
				() => undefined,
				async () => {
					const writeInput = clipboardInput(input);
					report = powerComputer.writeClipboard?.(writeInput) ?? writeClipboard(writeInput);
					return { route: "synthetic_events", delivery: "not_applicable" } as const;
				},
				{ fullState: input.full_state === true },
			);
			return appendReport(result, "clipboardWrite", report);
		},
	);
}

async function setFrame(
	computer: PowerComputer,
	pid: number,
	observation: InputObservation,
	requested: Rect,
): Promise<Awaited<ReturnType<typeof setWindowFrame>>> {
	return await (computer.setWindowFrame?.(pid, observation.windowId, requested) ??
		setWindowFrame(pid, observation.windowId, requested));
}

function clipboardInput(input: {
	readonly text?: string | undefined;
	readonly image_path?: string | undefined;
	readonly file_path?: string | undefined;
}): Parameters<typeof writeClipboard>[0] {
	if (input.text !== undefined) {
		return { type: "text", text: input.text };
	}
	if (input.image_path !== undefined) {
		return { type: "image", path: input.image_path };
	}
	if (input.file_path !== undefined) {
		return { type: "file-url", paths: [input.file_path] };
	}
	throw new Error("clipboard_write: provide exactly one clipboard value");
}

function appendReport(result: ToolResult, key: string, report: unknown): ToolResult {
	if (report === undefined) {
		return result;
	}
	return {
		content: [...result.content, { type: "text", text: JSON.stringify({ [key]: report }, null, 2) }],
	};
}
