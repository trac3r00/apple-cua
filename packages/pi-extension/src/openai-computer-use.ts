import type { ComputerInterface, Point, ScrollOptions } from "@macos-cua/core";

import { ComputerUseError, type ComputerUseResult } from "./anthropic-computer-use.js";
import { type DisplayConfig, unscaleCoord } from "./computer-use/coords.js";
import { screenshotResultWithCursor } from "./computer-use/screenshot-result.js";
import type { OpenAIComputerAction, OpenAIComputerToolInput } from "./openai-payload.js";
export {
	OPENAI_COMPUTER_TOOL_TYPE,
	addOpenAIComputerUseToPayload,
	openaiComputerActionBatchSchema,
	openaiComputerToolSchema,
	sanitizeOpenAIComputerUsePayload,
} from "./openai-payload.js";
export type { OpenAIComputerAction, OpenAIComputerActionBatch, OpenAIComputerToolInput } from "./openai-payload.js";

type KeyModifier = "command" | "option" | "control" | "shift";
type ScrollDirection = ScrollOptions["direction"];

export async function executeOpenAINativeComputerAction(
	input: OpenAIComputerToolInput,
	computer: ComputerInterface,
	display: DisplayConfig,
): Promise<ComputerUseResult> {
	return executeOpenAIComputerAction(input, computer, display);
}

export async function executeOpenAIComputerAction(
	input: OpenAIComputerAction,
	computer: ComputerInterface,
	display: DisplayConfig,
): Promise<ComputerUseResult> {
	try {
		switch (input.type) {
			case "click":
				await click(input, computer, display);
				return okResult(input.type);
			case "double_click":
				await computer.doubleClick(parsePosition(input.x, input.y, "double_click", display));
				return okResult(input.type);
			case "drag":
				await computer.drag(parseDrag(input.path, display));
				return okResult(input.type);
			case "keypress": {
				const keypress = normalizeOpenAIKeys(input.keys ?? []);
				await computer.key(
					keypress.key,
					keypress.modifiers.length === 0 ? undefined : { modifiers: keypress.modifiers },
				);
				return okResult(input.type);
			}
			case "move":
				await computer.move(parsePosition(input.x, input.y, "move", display));
				return okResult(input.type);
			case "screenshot":
				return await screenshotResultWithCursor(computer, display);
			case "scroll":
				await computer.move(parsePosition(input.x, input.y, "scroll", display));
				await computer.scroll(parseScroll(input.scroll_x, input.scroll_y));
				return okResult(input.type);
			case "type":
				await computer.type(parseText(input.text, "type"));
				return okResult(input.type);
			case "wait":
				await sleep(parseWaitDurationMilliseconds(input.duration));
				return textResult("wait complete");
		}
	} catch (error) {
		if (error instanceof ComputerUseError) {
			throw error;
		}
		throw new ComputerUseError("execution_failed", errorMessage(error), { cause: error });
	}
}

async function click(
	input: OpenAIComputerToolInput,
	computer: ComputerInterface,
	display: DisplayConfig,
): Promise<void> {
	const position = parsePosition(input.x, input.y, "click", display);
	for (const modifier of parseModifierKeys(input.keys ?? [])) {
		await computer.key(modifier);
	}
	switch (input.button ?? "left") {
		case "left":
			await computer.click(position);
			return;
		case "right":
			await computer.rightClick(position);
			return;
		case "wheel":
			await computer.middleClick(position);
			return;
		case "back":
		case "forward":
			throw new ComputerUseError("unsupported_action", "browser nav buttons not supported on macOS native", {
				action: "click",
			});
	}
}

function parsePosition(x: number | undefined, y: number | undefined, action: string, display: DisplayConfig): Point {
	if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new ComputerUseError("invalid_arguments", `${action} requires finite x and y`);
	}
	return unscaleCoord({ x, y }, display);
}

function parseDrag(
	path: readonly Point[] | undefined,
	display: DisplayConfig,
): { readonly from: Point; readonly to: Point } {
	if (path === undefined || path.length < 1) {
		throw new ComputerUseError("invalid_arguments", "drag requires at least one path point");
	}
	const from = path[0];
	const to = path.at(-1);
	if (from === undefined || to === undefined) {
		throw new ComputerUseError("invalid_arguments", "drag requires at least one path point");
	}
	if (path.length > 2) {
		process.stderr.write("macos-cua: collapsed OpenAI drag path to endpoints\n");
	}
	return {
		from: parsePosition(from.x, from.y, "drag.path[0]", display),
		to: parsePosition(to.x, to.y, "drag.path[last]", display),
	};
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

function parseScroll(
	scrollX: number | undefined,
	scrollY: number | undefined,
): {
	readonly direction: ScrollDirection;
	readonly amount: number;
} {
	const deltaX = scrollX ?? 0;
	const deltaY = scrollY ?? 0;
	if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
		throw new ComputerUseError("invalid_arguments", "scroll requires finite non-zero scroll_x or scroll_y");
	}
	if (Math.abs(deltaY) >= Math.abs(deltaX) && deltaY !== 0) {
		return { direction: deltaY > 0 ? "down" : "up", amount: Math.abs(deltaY) };
	}
	return { direction: deltaX > 0 ? "right" : "left", amount: Math.abs(deltaX) };
}

function parseText(text: string | undefined, action: string): string {
	if (text === undefined || text.length === 0) {
		throw new ComputerUseError("invalid_arguments", `${action} requires text`);
	}
	return text;
}

function parseWaitDurationMilliseconds(duration: number | undefined): number {
	const seconds = duration ?? 1;
	if (!Number.isFinite(seconds)) {
		throw new ComputerUseError("invalid_arguments", "wait requires finite duration");
	}
	return Math.min(10, Math.max(0, seconds)) * 1000;
}

function okResult(type: string): ComputerUseResult {
	return textResult(JSON.stringify({ ok: true, type }));
}

function textResult(text: string): ComputerUseResult {
	return {
		content: [{ type: "text", text }],
		details: undefined,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
