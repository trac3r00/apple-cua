import { parseElementIndex } from "@apple-cua/core";
import type { ElementQuery, GuardedComputerInterface } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { GuardedSession, RunControl } from "./guarded-session.js";
import { validateElement } from "./guarded-session.js";
import {
	click,
	clickResolvedTarget,
	drag,
	pressKeys,
	scroll,
	selectText,
	typeText,
	validateClick,
	validateDrag,
} from "./mutation-actions.js";
import { createRunStepDriver, expectFromInput } from "./step-actions.js";
import {
	clickSchema,
	clickTargetSchema,
	dragSchema,
	parseRunSteps,
	performSecondaryActionSchema,
	pressKeysSchema,
	runStepsSchema,
	scrollSchema,
	selectTextSchema,
	setFieldsSchema,
	setValueSchema,
	typeTextSchema,
} from "./tool-schemas.js";

/** The fuller contract (full_state, include_screenshot, the no-token case) is stated once in the server instructions. */
const MUTATION_CONTRACT =
	"Needs the one-use observation_token from the latest observation or mutation; answers with the fresh observation and the next token.";

export function elementQueryFromInput(input: {
	readonly role?: string | undefined;
	readonly label?: string | undefined;
	readonly label_contains?: string | undefined;
	readonly value_contains?: string | undefined;
	readonly text?: string | undefined;
}): ElementQuery {
	return {
		...(input.role === undefined ? {} : { role: input.role }),
		...(input.label === undefined ? {} : { label: input.label }),
		...(input.label_contains === undefined ? {} : { labelContains: input.label_contains }),
		...(input.value_contains === undefined ? {} : { valueContains: input.value_contains }),
		...(input.text === undefined ? {} : { text: input.text }),
	};
}

function outcomeOptions(input: {
	readonly full_state?: boolean | undefined;
	readonly include_screenshot?: boolean | undefined;
}): { readonly fullState: boolean; readonly includeScreenshot: boolean } {
	return { fullState: input.full_state === true, includeScreenshot: input.include_screenshot === true };
}

/** Cancellation and progress for a long batch, taken from the MCP request that started it. */
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
					process.stderr.write(`Failed to send run_steps progress: ${details}\n`);
				});
		},
	};
}

function mutationDescription(specific: string): string {
	return `${specific} ${MUTATION_CONTRACT}`;
}

const MUTATION_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true } as const;

/** The element-action tools: everything that dispatches input after an observation. Absent from the lean toolset. */
export function registerDesktopMutationTools(
	server: McpServer,
	session: GuardedSession,
	resolvedComputer: GuardedComputerInterface,
): void {
	server.registerTool(
		"click",
		{
			description: mutationDescription(
				"Click an observed element id (semantic path) or screenshot coordinates x,y (last resort); click_count for a double click, mouse_button for right/middle. modifiers (command, shift, option, control) are held during the click, e.g. command-click to add to a selection; an element id with modifiers is clicked at its centre through the pointer route instead of AXPress.",
			),
			inputSchema: clickSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateClick(input, observation),
				async (targetPid, observation) => await click(resolvedComputer, targetPid, observation, input),
				{ ...outcomeOptions(input), screenPoints: input.element_index === undefined },
			),
	);

	server.registerTool(
		"click_target",
		{
			description: mutationDescription(
				"Act on a described element in one call: observe, resolve the query, wait up to timeout_ms for it, hover first if hover_first, then press via AXPress when advertised, else click its centre (also when press=pointer or the button is not left). Answers with the resolved target, alternatives not clicked, route and delivery used, and with expect whether the outcome verified. found=false: nothing matched in time, no input was dispatched, near misses are listed and the token for the ids seen is still returned.",
			),
			inputSchema: clickTargetSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.clickTarget(
				{
					app: input.app,
					query: elementQueryFromInput(input.query),
					...(input.index === undefined ? {} : { index: input.index }),
					...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
					...(input.press === undefined ? {} : { press: input.press }),
					...(input.hover_first === undefined ? {} : { hoverFirst: input.hover_first }),
					...(input.click_count === undefined ? {} : { clickCount: input.click_count }),
					...(input.mouse_button === undefined ? {} : { mouseButton: input.mouse_button }),
					...(input.window_id === undefined ? {} : { windowId: input.window_id }),
					...(input.expect === undefined
						? {}
						: {
								expect: {
									...(input.expect.checks === undefined ? {} : { checks: input.expect.checks }),
									...(input.expect.window_title === undefined
										? {}
										: { windowTitle: input.expect.window_title }),
									...(input.expect.timeout_ms === undefined ? {} : { timeoutMs: input.expect.timeout_ms }),
								},
							}),
					fullState: input.full_state === true,
					includeScreenshot: input.include_screenshot === true,
				},
				async (targetPid, observation, target) =>
					await clickResolvedTarget(resolvedComputer, targetPid, observation, target),
			),
	);

	server.registerTool(
		"perform_secondary_action",
		{
			description: mutationDescription(
				"Invoke one of the secondary accessibility actions advertised for an observed element (for example AXShowMenu).",
			),
			inputSchema: performSecondaryActionSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			const index = () => parseElementIndex(input.element_index);
			return await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateElement(observation, index()),
				async (targetPid) => {
					await resolvedComputer.performAction(targetPid, index(), input.action);
					return { route: "accessibility", delivery: "background" } as const;
				},
				outcomeOptions(input),
			);
		},
	);

	server.registerTool(
		"set_value",
		{
			description: mutationDescription(
				"Set the value of an observed editable accessibility element. Use set_fields to change several fields in one verified call.",
			),
			inputSchema: setValueSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			const index = () => parseElementIndex(input.element_index);
			return await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateElement(observation, index()),
				async (targetPid) => {
					await resolvedComputer.setValue(targetPid, index(), input.value);
					return { route: "accessibility", delivery: "background" } as const;
				},
				outcomeOptions(input),
			);
		},
	);

	server.registerTool(
		"set_fields",
		{
			description: mutationDescription(
				"Set several observed element values in one call (up to 10 updates, applied in order). Each update is checked against a fresh observation before dispatch and read back after: per-field status verified, unverified or skipped with a reason, plus requested/inputDispatched/verified counts. Stops at the first field it cannot verify and reports progress so far.",
			),
			inputSchema: setFieldsSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.setFields(input.observation_token, input.app, input.updates, outcomeOptions(input)),
	);

	server.registerTool(
		"run_steps",
		{
			description: mutationDescription(
				"Run a whole flow in one call (up to 20 steps), e.g. fill-then-submit or open-menu-then-choose. Each step is a flat object; type picks the kind (its description lists the fields per type). An element is named by element_index (re-checked against a fresh read before dispatch) or by target (resolved right before the step, so it can act on UI an earlier step created). wait_for pauses until the screen shows (gone=true: stops showing) target and/or window_title. Every step is validated before any is dispatched. The batch stops at the first step that fails, finds no match or times out, reporting per-step dispatched/satisfied/skipped/failed with a reason, the element each target resolved to and any route fallback. Cancellable between steps; progress notifications with a progressToken. expect verifies the outcome in the same call, like verify_state. pace=fast runs a person-like chain back to back.",
			),
			inputSchema: runStepsSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input, extra) =>
			await session.runSteps(
				input.observation_token,
				input.app,
				parseRunSteps(input.steps, "run_steps"),
				expectFromInput(input.expect),
				createRunStepDriver(resolvedComputer),
				outcomeOptions(input),
				{ ...runControlFrom(extra), ...(input.pace === undefined ? {} : { pace: input.pace }) },
			),
	);

	server.registerTool(
		"select_text",
		{
			description: mutationDescription(
				"Select text (or place the caret with selection=before/after) in an observed text element.",
			),
			inputSchema: selectTextSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			const index = () => parseElementIndex(input.element_index);
			return await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateElement(observation, index()),
				async (targetPid) => await selectText(resolvedComputer, targetPid, index(), input),
				outcomeOptions(input),
			);
		},
	);

	server.registerTool(
		"drag",
		{
			description: mutationDescription(
				"Drag from one screenshot coordinate to another; modifiers are held for the whole drag, e.g. option-drag to copy.",
			),
			inputSchema: dragSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateDrag(input, observation),
				async (targetPid, observation) => await drag(resolvedComputer, targetPid, observation, input),
				{ ...outcomeOptions(input), screenPoints: true },
			),
	);

	server.registerTool(
		"scroll",
		{
			description: mutationDescription(
				"Scroll an observed scrollable element by whole pages through its page-scroll accessibility action (works in the background). Modifiers are refused before anything is sent. To scroll until something shows, give a click/set_value/select_text step in run_steps a target and a find field.",
			),
			inputSchema: scrollSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			const index = () => parseElementIndex(input.element_index);
			return await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateElement(observation, index()),
				async (targetPid) => await scroll(resolvedComputer, targetPid, index(), input),
				outcomeOptions(input),
			);
		},
	);

	server.registerTool(
		"type_text",
		{
			description: mutationDescription("Type literal text into the observed app's focused input."),
			inputSchema: typeTextSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.mutate(
				input.observation_token,
				input.app,
				() => undefined,
				async (targetPid) => await typeText(resolvedComputer, targetPid, input.text),
				outcomeOptions(input),
			),
	);

	server.registerTool(
		"press_keys",
		{
			description: mutationDescription("Press a deliberate key or chord sequence in the observed app's context."),
			inputSchema: pressKeysSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.mutate(
				input.observation_token,
				input.app,
				() => undefined,
				async (targetPid) => await pressKeys(resolvedComputer, targetPid, input),
				outcomeOptions(input),
			),
	);
}
