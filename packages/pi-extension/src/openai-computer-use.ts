import {
	ComputerUseError,
	type ComputerUseResult,
	MCP_GAPS,
	type MouseButton,
	type NativeComputer,
	type Point,
	errorMessage,
	textResult,
	unsupportedAction,
} from "./computer-use/native-computer.js";
import type { OpenAIComputerAction, OpenAIComputerToolInput } from "./openai-payload.js";
export {
	addOpenAIComputerUseToPayload,
	openaiComputerActionBatchSchema,
	openaiComputerToolSchema,
	sanitizeOpenAIComputerUsePayload,
} from "./openai-payload.js";
export type { OpenAIComputerAction, OpenAIComputerActionBatch } from "./openai-payload.js";

type KeyModifier = "command" | "option" | "control" | "shift";

const MAX_WAIT_SECONDS = 10;
const DEFAULT_WAIT_SECONDS = 1;

/** One OpenAI computer action as apple-cua-mcp calls; actions the server cannot do are refused by name. */
export async function executeOpenAIComputerAction(
	input: OpenAIComputerAction,
	computer: NativeComputer,
): Promise<ComputerUseResult> {
	try {
		switch (input.type) {
			case "click":
				return await computer.click(parsePosition(input.x, input.y, "click"), {
					button: parseButton(input.button),
					count: 1,
					modifiers: parseModifierKeys(input.keys ?? []),
				});
			case "double_click":
				return await computer.click(parsePosition(input.x, input.y, "double_click"), {
					button: "left",
					count: 2,
					modifiers: [],
				});
			case "drag": {
				const [from, to] = parseDragPath(input.path);
				return await computer.drag(from, to);
			}
			case "keypress": {
				const keypress = normalizeOpenAIKeys(input.keys ?? []);
				return await computer.pressKeys([[...keypress.modifiers, keypress.key].join("+")]);
			}
			case "move":
				throw unsupportedAction(input.type, MCP_GAPS.pointerMove);
			case "screenshot":
				return await computer.screenshot();
			case "scroll":
				throw unsupportedAction(input.type, MCP_GAPS.scroll);
			case "type":
				return await computer.typeText(parseText(input.text, "type"));
			case "wait":
				await computer.wait(parseWaitDurationMilliseconds(input.duration));
				return textResult("wait complete");
		}
	} catch (error) {
		if (error instanceof ComputerUseError) {
			throw error;
		}
		throw new ComputerUseError("execution_failed", errorMessage(error), { action: input.type, cause: error });
	}
}

function parseButton(button: OpenAIComputerToolInput["button"]): MouseButton {
	switch (button ?? "left") {
		case "left":
			return "left";
		case "right":
			return "right";
		case "wheel":
			return "middle";
		default:
			throw unsupportedAction("click", MCP_GAPS.navigationButton);
	}
}

function parsePosition(x: number | undefined, y: number | undefined, action: string): Point {
	if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new ComputerUseError("invalid_arguments", `${action} requires finite x and y`);
	}
	return { x, y };
}

function parseDragPath(path: readonly Point[] | undefined): readonly [Point, Point] {
	if (path === undefined || path.length < 2) {
		throw new ComputerUseError("invalid_arguments", "drag requires a path with a start and an end point");
	}
	const [from, to] = path;
	if (path.length > 2 || from === undefined || to === undefined) {
		throw unsupportedAction("drag", MCP_GAPS.dragPath);
	}
	return [parsePosition(from.x, from.y, "drag.path[0]"), parsePosition(to.x, to.y, "drag.path[1]")];
}

export function normalizeOpenAIKeys(keys: string[]): { readonly key: string; readonly modifiers: KeyModifier[] } {
	if (keys.length === 0) {
		throw new ComputerUseError("invalid_arguments", "keypress requires keys");
	}
	const key = keys.at(-1);
	if (key === undefined || key.length === 0) {
		throw new ComputerUseError("invalid_arguments", "keypress requires a final key");
	}
	return { key: normalizeOpenAIKey(key), modifiers: parseModifierKeys(keys.slice(0, -1)) };
}

function parseModifierKeys(keys: readonly string[]): KeyModifier[] {
	const modifiers: KeyModifier[] = [];
	for (const key of keys) {
		const modifier = modifierFromKey(key);
		if (modifier === undefined) {
			throw new ComputerUseError("invalid_arguments", `unsupported modifier key: ${key}`);
		}
		modifiers.push(modifier);
	}
	return modifiers;
}

function modifierFromKey(key: string): KeyModifier | undefined {
	switch (key.trim().toLowerCase()) {
		case "control":
		case "ctrl":
			return "control";
		case "shift":
			return "shift";
		case "alt":
		case "option":
			return "option";
		case "meta":
		case "cmd":
		case "command":
			return "command";
		default:
			return undefined;
	}
}

function normalizeOpenAIKey(key: string): string {
	switch (key.trim().toLowerCase()) {
		case "enter":
		case "return":
			return "enter";
		case "escape":
		case "esc":
			return "escape";
		default:
			return key.trim().toLowerCase();
	}
}

function parseText(text: string | undefined, action: string): string {
	if (text === undefined || text.length === 0) {
		throw new ComputerUseError("invalid_arguments", `${action} requires text`);
	}
	return text;
}

function parseWaitDurationMilliseconds(duration: number | undefined): number {
	const seconds = duration ?? DEFAULT_WAIT_SECONDS;
	if (!Number.isFinite(seconds)) {
		throw new ComputerUseError("invalid_arguments", "wait requires finite duration");
	}
	return Math.min(MAX_WAIT_SECONDS, Math.max(0, seconds)) * 1000;
}
