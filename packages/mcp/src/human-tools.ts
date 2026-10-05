import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { GuardedSession } from "./guarded-session.js";
import { textResult } from "./tool-result.js";

const askUserSchema = z.object({
	question: z.string().min(1),
	options: z.array(z.string().min(1)).min(2).max(8).optional(),
	allow_free_text: z.boolean().optional(),
	reason: z
		.enum(["blocked", "ambiguous_target", "needs_value", "confirm_risky", "handoff", "screen_locked", "permission"])
		.optional(),
	app: z.string().min(1).optional(),
});

const INSTRUCTION =
	"Relay this question to the user with your own question tool (for example ask_user_question), then continue with their answer. Do not guess.";

export function registerHumanTools(server: McpServer, session: GuardedSession): void {
	server.registerTool(
		"ask_user",
		{
			description:
				"Ask the human when the task is blocked, ambiguous, needs a value or confirmation, or requires a handoff. Uses client elicitation when available; otherwise returns a question the agent must relay. An accepted handoff or screen unlock with app returns a fresh observation.",
			inputSchema: askUserSchema,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (input) => {
			const fallback = () =>
				textResult(
					JSON.stringify({
						needs_user: true,
						question: input.question,
						...(input.options === undefined ? {} : { options: input.options }),
						...(input.reason === undefined ? {} : { reason: input.reason }),
						instruction: INSTRUCTION,
					}),
				);
			if (server.server.getClientCapabilities()?.elicitation === undefined) return fallback();

			const freeText = input.allow_free_text === true || input.options === undefined;
			let result: ElicitResult;
			try {
				result = await server.server.elicitInput({
					message: input.question,
					requestedSchema: {
						type: "object",
						properties: {
							...(input.options === undefined
								? {}
								: { choice: { type: "string" as const, enum: input.options } }),
							...(freeText ? { answer: { type: "string" as const } } : {}),
						},
						...(input.options === undefined
							? { required: ["answer"] }
							: freeText
								? {}
								: { required: ["choice"] }),
					},
				});
			} catch (error: unknown) {
				if (!(error instanceof Error)) throw error;
				return fallback();
			}

			switch (result.action) {
				case "accept": {
					const choice = result.content?.["choice"];
					const answer = result.content?.["answer"];
					const response = {
						answered: typeof choice === "string" || typeof answer === "string",
						action: result.action,
						...(typeof choice === "string" ? { choice } : {}),
						...(typeof answer === "string" ? { answer } : {}),
					};
					if (
						response.answered &&
						input.app !== undefined &&
						(input.reason === "handoff" || input.reason === "screen_locked")
					) {
						const observation = await session.observe({ app: input.app, diffOnly: false });
						return {
							...observation,
							content: observation.content.map((item) =>
								item.type === "text"
									? {
											...item,
											text: JSON.stringify({
												...z.record(z.string(), z.unknown()).parse(JSON.parse(item.text)),
												...response,
											}),
										}
									: item,
							),
						};
					}
					return textResult(JSON.stringify(response));
				}
				case "decline":
				case "cancel":
					return textResult(JSON.stringify({ answered: false, action: result.action }));
				default: {
					const unreachable: never = result.action;
					throw new Error(`Unexpected elicitation action: ${unreachable}`);
				}
			}
		},
	);
}
