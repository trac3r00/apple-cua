import type { GuardedComputerInterface } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { GuardedSession, RunControl } from "./guarded-session.js";
import { createRunStepDriver, expectFromInput } from "./step-actions.js";
import { type RunStep, parseRunSteps, runHandsSchema } from "./tool-schemas.js";

const KEYBOARD_STEP_TYPES = new Set<RunStep["type"]>(["type_text", "press_keys"]);
const POINTER_STEP_TYPES = new Set<RunStep["type"]>(["click", "drag", "scroll"]);

function laneSteps(
	input: readonly unknown[] | undefined,
	tool: string,
	lane: "keyboard" | "pointer",
	allowed: ReadonlySet<RunStep["type"]>,
): RunStep[] {
	if (input === undefined) {
		return [];
	}
	const steps = parseRunSteps(input, tool, lane);
	for (const [index, step] of steps.entries()) {
		if (!allowed.has(step.type)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Input validation error: ${lane}[${index}] (${step.type}) is not allowed in the ${lane} lane; allowed: ${[...allowed].join(", ")}`,
			);
		}
		if (
			("target" in step && step.target !== undefined) ||
			("find" in step && step.find !== undefined) ||
			(step.type === "click" && step.element_index === undefined && (step.x === undefined || step.y === undefined))
		) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Input validation error: ${lane}[${index}] (${step.type}) needs an explicit element_index or x/y from the current observation; run_hands does not resolve described targets`,
			);
		}
	}
	return steps;
}

/** Cancellation and progress for the long two-lane call, taken from the MCP request. */
function runControlFrom(extra: RequestHandlerExtra<ServerRequest, ServerNotification>): RunControl {
	const progressToken = extra._meta?.progressToken;
	if (progressToken === undefined) {
		return { signal: extra.signal };
	}
	return {
		signal: extra.signal,
		onProgress: (progress, total, message) => {
			extra
				.sendNotification({ method: "notifications/progress", params: { progressToken, progress, total, message } })
				.catch((error: unknown) => {
					const details = error instanceof Error ? error.message : String(error);
					process.stderr.write(`Failed to send run_hands progress: ${details}\n`);
				});
		},
	};
}

/**
 * One call for a person-like two-handed action: keyboard and pointer lanes share the current
 * observation, an optional vision capture watches while they run, and only the final state is
 * read back. Conflicting lanes serialize; disjoint lanes may overlap in background delivery.
 */
export function registerHandsTools(
	server: McpServer,
	session: GuardedSession,
	computer: GuardedComputerInterface,
): void {
	server.registerTool(
		"run_hands",
		{
			description:
				"Run keyboard and pointer lanes plus an optional vision capture against one observation in one guarded call. keyboard allows type_text/press_keys; pointer allows click/drag/scroll with explicit element_index or x/y; vision captures the window while input runs. overlap=auto (default) overlaps lanes whose resources do not conflict, never serializes, always refuses a shared resource. outcome=deferred (default for input-only calls) skips the result read; the next token's element ids predate the action. outcome=live reads the fresh state as before. Background delivery can type and point at once; attended delivery serializes focus-sensitive lanes. Returns per-lane steps, wait/duration/overlap timing, and the next observation_token.",
			inputSchema: runHandsSchema,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (input, extra) => {
			const keyboard = laneSteps(input.keyboard, "run_hands", "keyboard", KEYBOARD_STEP_TYPES);
			const pointer = laneSteps(input.pointer, "run_hands", "pointer", POINTER_STEP_TYPES);
			return await session.runHands(
				{
					app: input.app,
					token: input.observation_token,
					keyboard,
					pointer,
					...(input.vision === undefined
						? {}
						: {
								vision: {
									...(input.vision.include_screenshot === undefined
										? {}
										: { includeScreenshot: input.vision.include_screenshot }),
									...(input.vision.settle_ms === undefined ? {} : { settleMs: input.vision.settle_ms }),
									...(input.vision.max_elements === undefined
										? {}
										: { maxElements: input.vision.max_elements }),
								},
							}),
					overlap: input.overlap ?? "auto",
					...(input.expect === undefined ? {} : { expect: expectFromInput(input.expect) }),
					...(input.outcome === undefined ? {} : { outcomeMode: input.outcome }),
					fullState: input.full_state === true,
					includeScreenshot: input.include_screenshot === true,
				},
				createRunStepDriver(computer),
				runControlFrom(extra),
			);
		},
	);
}
