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
const MUTATION_CONTRACT = "Needs the latest one-use observation_token; returns fresh state and the next token.";

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
				"Click an observed element id or screenshot coordinates x,y. click_count repeats; mouse_button selects left/right/middle. A single unmodified right click uses advertised AXShowMenu or pointer input, never AXPress. modifiers are held during the click; modified element clicks use the pointer at the element centre, not AXPress.",
			),
			inputSchema: clickSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) =>
			await session.mutate(
				input.observation_token,
				input.app,
				(observation) => validateClick(input, observation),
				async (targetPid, observation, elements) =>
					await click(
						resolvedComputer,
						targetPid,
						observation,
						input,
						input.element_index === undefined
							? undefined
							: elements?.get(parseElementIndex(input.element_index))?.actions,
					),
				{ ...outcomeOptions(input), screenPoints: input.element_index === undefined },
			),
	);

	server.registerTool(
		"click_target",
		{
			description: mutationDescription(
				"Observe and resolve a described element, optionally wait up to timeout_ms and hover first, then use AXPress when advertised or click its centre. A single right click uses AXShowMenu unless press=pointer, never AXPress. Returns target, alternatives, route, delivery, and expect verification. found=false means no input; near misses and the token are returned.",
			),
			inputSchema: clickTargetSchema,
			annotations: MUTATION_ANNOTATIONS,
		},
		async (input) => {
			const expect = expectFromInput(input.expect);
			return await session.clickTarget(
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
					...(expect === undefined ? {} : { expect }),
					fullState: input.full_state === true,
					includeScreenshot: input.include_screenshot === true,
				},
				async (targetPid, observation, target) =>
					await clickResolvedTarget(resolvedComputer, targetPid, observation, target),
			);
		},
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
				"Set the value of an observed editable accessibility element. Answers setValue with requested_value, observed_value and verified from a fresh read; input dispatch alone is not confirmation. Use set_fields to change several fields in one verified call.",
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
				{ ...outcomeOptions(input), valueCheck: { elementIndex: index(), value: input.value } },
			);
		},
	);

	server.registerTool(
		"set_fields",
		{
			description: mutationDescription(
				"Set up to 10 observed fields in order. Each is checked before dispatch and read back; returns per-field status and counts. Stops at the first unverifiable field.",
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
				"Run up to 20 ordered steps; type selects fields. Use element_index (rechecked) or target (resolved before action, including newly created UI). wait_for pauses for target/window_title; gone=true waits for disappearance. All steps validate before dispatch; stops at first failure, no match, or timeout with step status and reason. Cancellable between steps; progress needs progressToken. expect verifies outcome; pace=fast uses cheap guards between actions.",
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
				"Drag between screenshot coordinates, optionally passing through up to 100 screenshot-local waypoints. Select mouse_button (left, right, middle), duration_ms (0-30000), and modifiers held throughout the gesture.",
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
