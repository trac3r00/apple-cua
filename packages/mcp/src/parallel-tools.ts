import type { GuardedComputerInterface } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GuardedSession } from "./guarded-session.js";
import { createRunStepDriver, expectFromInput } from "./step-actions.js";
import type { ToolContent, ToolResult } from "./tool-result.js";
import { observeAppsSchema, parseRunSteps, runParallelSchema } from "./tool-schemas.js";

interface AppOutcome {
	readonly app: string;
	readonly result?: ToolResult;
	readonly error?: string;
}

async function settle(app: string, run: () => Promise<ToolResult>): Promise<AppOutcome> {
	try {
		return { app, result: await run() };
	} catch (error: unknown) {
		return { app, error: error instanceof Error ? error.message : String(error) };
	}
}

function parsedText(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * One answer for several apps: each app's own answer, parsed, under its name, with every image
 * kept and indexed so the caller can tell whose window it shows. The call is an error only when
 * every app failed, so one busy app does not hide what the others did.
 */
function combine(key: "apps" | "batches", outcomes: readonly AppOutcome[]): ToolResult {
	const images: ToolContent[] = [];
	const entries = outcomes.map((outcome) => {
		if (outcome.result === undefined) {
			return { app: outcome.app, ok: false, error: outcome.error ?? "failed without a message" };
		}
		const texts: unknown[] = [];
		const imageIndexes: number[] = [];
		for (const item of outcome.result.content) {
			if (item.type === "text") {
				texts.push(parsedText(item.text));
			} else {
				imageIndexes.push(images.length);
				images.push(item);
			}
		}
		return {
			app: outcome.app,
			ok: outcome.result.isError !== true,
			result: texts.length === 1 ? texts[0] : texts,
			...(imageIndexes.length === 0 ? {} : { images: imageIndexes }),
		};
	});
	return {
		content: [{ type: "text", text: JSON.stringify({ [key]: entries }, null, 2) }, ...images],
		...(entries.every((entry) => !entry.ok) ? { isError: true } : {}),
	};
}

export function registerParallelTools(
	server: McpServer,
	session: GuardedSession,
	computer: GuardedComputerInterface,
): void {
	server.registerTool(
		"observe_apps",
		{
			description:
				"Read-only: observe several approved apps concurrently in one call. Each app answers as get_app_state would (elements with ids, its own one-use observation_token) under its name in apps[]. Text-only by default (include_screenshot=true adds each window image, indexed in images[]), elements as tab-separated element_rows (element_format=json for objects); diff_only and max_elements apply to every app. One app failing (not running, locked out, not approved) is reported in its entry and does not fail the others.",
			inputSchema: observeAppsSchema,
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async (input) =>
			combine(
				"apps",
				await Promise.all(
					input.apps.map((app) =>
						settle(app, () =>
							session.observe({
								app,
								diffOnly: input.diff_only === true,
								includeScreenshot: input.include_screenshot === true,
								...(input.max_elements === undefined ? {} : { maxElements: input.max_elements }),
								elementFormat: input.element_format ?? "table",
							}),
						),
					),
				),
			),
	);

	server.registerTool(
		"run_parallel",
		{
			description:
				"Drive several different apps in one call: each batch is a run_steps batch (same steps and expect block) for one app, with that app's own observation_token. Every step of every batch is validated before anything is dispatched. Under background delivery the batches run concurrently (each app has its own input lane); under attended delivery they run one after another (they would share the keyboard and pointer). Answers batches[] with each app's run_steps answer, including its next observation_token. A failing batch is reported in its entry and does not stop the others. pace=\"fast\" applies to every batch, as in run_steps.",
			inputSchema: runParallelSchema,
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async (input, extra) => {
			const batches = input.batches.map((batch, index) => ({
				...batch,
				steps: parseRunSteps(batch.steps, "run_parallel", `batches[${index}].steps`),
			}));
			const driver = createRunStepDriver(computer);
			const options = { fullState: input.full_state === true, includeScreenshot: input.include_screenshot === true };
			const runBatch = (batch: (typeof batches)[number]): Promise<AppOutcome> =>
				settle(batch.app, () =>
					session.runSteps(
						batch.observation_token,
						batch.app,
						batch.steps,
						expectFromInput(batch.expect),
						driver,
						options,
						{ signal: extra.signal, ...(input.pace === undefined ? {} : { pace: input.pace }) },
					),
				);
			if (computer.delivery === "background") {
				return combine("batches", await Promise.all(batches.map(runBatch)));
			}
			const outcomes: AppOutcome[] = [];
			for (const batch of batches) {
				outcomes.push(await runBatch(batch));
			}
			return combine("batches", outcomes);
		},
	);
}
