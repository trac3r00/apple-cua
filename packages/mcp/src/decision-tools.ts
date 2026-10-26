import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { GuardedSession } from "./guarded-session.js";

const runDecisionSchema = z.object({
	app: z.string().min(1),
	goal: z.string().min(1).max(2_000),
	max_steps: z.number().int().positive().max(60).optional(),
	approve_risk: z.boolean().optional(),
	timeout_ms: z.number().int().positive().max(60_000).optional(),
});

const READ_ONLY_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true } as const;

/**
 * The Jev decision surface: the model hands a goal, the indexed action space and a per-step
 * fan-out decision call do the stepping. Requires APPLE_CUA_DECISION_ENDPOINT plus a key;
 * scripts/llm-pool-systemone.mjs serves the local endpoint when a direct one is unavailable.
 */
export function registerDecisionTools(server: McpServer, session: GuardedSession): void {
	server.registerTool(
		"run_decision",
		{
			description:
				"Drive one app toward a goal with the Jev decision kernel: per step it observes an indexed element table, makes one fan-out decision call (operation + target + risk), and executes it. Low-risk UI steps run on their own; anything at or above the risk threshold stops as needs-approval unless approve_risk is true. max_steps caps the decision records processed (default 8, max 60). Needs APPLE_CUA_DECISION_ENDPOINT and LLM_POOL_PROXY_API_KEY or TYPESAFE_API_KEY.",
			inputSchema: runDecisionSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async (input) => {
			return await session.runDecision({
				app: input.app,
				goal: input.goal,
				...(input.max_steps === undefined ? {} : { maxSteps: input.max_steps }),
				...(input.approve_risk === undefined ? {} : { approveRisk: input.approve_risk }),
				...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
			});
		},
	);
}
