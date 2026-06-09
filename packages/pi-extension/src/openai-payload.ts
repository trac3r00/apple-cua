import { type Static, Type } from "typebox";

import type { DisplayConfig } from "./computer-use/coords.js";

export const OPENAI_COMPUTER_TOOL_TYPE = "computer";
const OPENAI_COMPUTER_TOOL_NAME = "computer";

const actionPointSchema = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });
const safetyCheckSchema = Type.Object(
	{
		id: Type.Optional(Type.String()),
		code: Type.Optional(Type.String()),
		message: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export const openaiComputerToolSchema = Type.Object(
	{
		type: Type.Union([
			Type.Literal("click"),
			Type.Literal("double_click"),
			Type.Literal("drag"),
			Type.Literal("keypress"),
			Type.Literal("move"),
			Type.Literal("screenshot"),
			Type.Literal("scroll"),
			Type.Literal("type"),
			Type.Literal("wait"),
		]),
		x: Type.Optional(Type.Number()),
		y: Type.Optional(Type.Number()),
		button: Type.Optional(
			Type.Union([
				Type.Literal("left"),
				Type.Literal("right"),
				Type.Literal("wheel"),
				Type.Literal("back"),
				Type.Literal("forward"),
			]),
		),
		keys: Type.Optional(Type.Array(Type.String())),
		path: Type.Optional(Type.Array(actionPointSchema)),
		scroll_x: Type.Optional(Type.Number()),
		scroll_y: Type.Optional(Type.Number()),
		text: Type.Optional(Type.String()),
		duration: Type.Optional(Type.Number()),
		pending_safety_checks: Type.Optional(Type.Array(safetyCheckSchema)),
	},
	{ additionalProperties: false },
);

export type OpenAIComputerToolInput = Static<typeof openaiComputerToolSchema>;
export type OpenAIComputerAction = OpenAIComputerToolInput;

export const openaiComputerActionBatchSchema = Type.Object(
	{ actions: Type.Array(openaiComputerToolSchema, { minItems: 1 }) },
	{ additionalProperties: false },
);

export type OpenAIComputerActionBatch = Static<typeof openaiComputerActionBatchSchema>;

export function sanitizeOpenAIComputerUsePayload(api: string | undefined, payload: unknown): unknown {
	if ((api !== "openai-responses" && api !== "openai-completions") || !isRecord(payload)) {
		return payload;
	}
	const tools = Array.isArray(payload["tools"]) ? payload["tools"] : [];
	const sanitizedTools = sanitizeOpenAITools(tools);
	if (sanitizedTools.length === tools.length) {
		return payload;
	}
	return { ...payload, tools: sanitizedTools };
}

export function addOpenAIComputerUseToPayload(
	api: string | undefined,
	payload: unknown,
	display: DisplayConfig,
): unknown {
	void display;
	if (api !== "openai-responses" || !isRecord(payload)) {
		return payload;
	}

	const existingTools = Array.isArray(payload["tools"]) ? payload["tools"] : [];
	const sanitizedTools = sanitizeOpenAITools(existingTools);
	const hasComputerTool = sanitizedTools.some((tool) => isRecord(tool) && tool["type"] === OPENAI_COMPUTER_TOOL_TYPE);
	const tools = hasComputerTool ? sanitizedTools : [...sanitizedTools, { type: OPENAI_COMPUTER_TOOL_TYPE }];
	return { ...payload, tools };
}

function sanitizeOpenAITools(tools: readonly unknown[]): unknown[] {
	const sanitizedTools: unknown[] = [];
	for (const tool of tools) {
		if (!isOpenAIComputerFunctionTool(tool)) {
			sanitizedTools.push(tool);
		}
	}
	return sanitizedTools;
}

function isOpenAIComputerFunctionTool(tool: unknown): boolean {
	if (!isRecord(tool) || tool["type"] !== "function") {
		return false;
	}
	if (tool["name"] === OPENAI_COMPUTER_TOOL_NAME) {
		return true;
	}
	const nestedFunction = tool["function"];
	return isRecord(nestedFunction) && nestedFunction["name"] === OPENAI_COMPUTER_TOOL_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
