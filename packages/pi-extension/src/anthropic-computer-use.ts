import type { ComputerInterface, Point } from "@macos-cua/core";

import type { ComputerToolInput } from "./anthropic-payload.js";
export {
	ANTHROPIC_COMPUTER_USE_BETA,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
	ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
	addAnthropicComputerUseToPayload,
	anthropicComputerToolSchema,
	computerToolSchema,
	mergeBetaHeader,
	sanitizeTools,
	supportsAnthropicNativeComputerUse,
} from "./anthropic-payload.js";
export type { ComputerToolInput } from "./anthropic-payload.js";
import { type DisplayConfig, unscaleCoord } from "./computer-use/coords.js";
import { screenshotResultWithCursor } from "./computer-use/screenshot-result.js";
import type { AgentToolResult } from "./pi/index.js";

type ComputerUseErrorKind = "unsupported_action" | "invalid_arguments" | "execution_failed";
export type ComputerUseResult = AgentToolResult<undefined>;
type KeyModifier = "command" | "option" | "control" | "shift" | "cmd" | "alt" | "ctrl";
type ScrollDirection = "up" | "down" | "left" | "right";

export interface ComputerActionDriver extends Omit<ComputerInterface, "key" | "scroll"> {
	key(key: string, options?: { readonly modifiers?: readonly KeyModifier[] }): Promise<void>;
	scroll(options: { readonly direction: ScrollDirection; readonly amount: number }): Promise<void>;
}

const TRIPLE_CLICK_GAP_MILLISECONDS = 30;
const DEFAULT_DRAG_DURATION_MILLISECONDS = 500;
const MAX_WAIT_SECONDS = 10;

export class ComputerUseError extends Error {
	readonly kind: ComputerUseErrorKind;
	readonly action: string | undefined;

	constructor(
		kind: ComputerUseErrorKind,
		message: string,
		options?: { readonly action?: string; readonly cause?: unknown },
	) {
		super(message, options);
		this.name = kind === "unsupported_action" ? "UnsupportedAnthropicAction" : "ComputerUseError";
		this.kind = kind;
		this.action = options?.action;
	}
}

export function buildCodexComputerUseSection(): string {
	return "## Computer Use\nCall `get_app_state` each turn. Use Codex tools (`click`, `set_value`, `perform_secondary_action`, `scroll`, `type_text`, `press_keys`) for macOS control. Actions return {ok:true}.\n";
}

export function buildComputerUseSection(width: number, height: number): string {
	return `## Computer Use\nCall \`get_app_state\` each turn. Use \`computer\` for mouse/keyboard (${width}x${height}); AX: \`set_value\`, \`perform_secondary_action\`. Actions return {ok:true}.\n`;
}

export async function executeNativeComputerAction(
	input: ComputerToolInput,
	computer: ComputerActionDriver,
	display: DisplayConfig,
): Promise<ComputerUseResult> {
	try {
		switch (input.action) {
			case "screenshot":
				return await screenshotResultWithCursor(computer, display);
			case "mouse_move":
				await computer.move(unscaleCoord(parseCoordinate(input.coordinate, "mouse_move"), display));
				return okResult(input.action);
			case "left_click":
				await computer.click(unscaleCoord(parseCoordinate(input.coordinate, "left_click"), display));
				return okResult(input.action);
			case "right_click":
				await computer.rightClick(unscaleCoord(parseCoordinate(input.coordinate, "right_click"), display));
				return okResult(input.action);
			case "middle_click":
				await computer.middleClick(unscaleCoord(parseCoordinate(input.coordinate, "middle_click"), display));
				return okResult(input.action);
			case "double_click":
				await computer.doubleClick(unscaleCoord(parseCoordinate(input.coordinate, "double_click"), display));
				return okResult(input.action);
			case "triple_click":
				await tripleClick(computer, unscaleCoord(parseCoordinate(input.coordinate, "triple_click"), display));
				return okResult(input.action);
			case "left_click_drag":
				await computer.drag({
					from: unscaleCoord(parseCoordinate(input.start_coordinate, "left_click_drag.start_coordinate"), display),
					to: unscaleCoord(parseCoordinate(input.coordinate, "left_click_drag.coordinate"), display),
					duration: DEFAULT_DRAG_DURATION_MILLISECONDS,
				});
				return okResult(input.action);
			case "cursor_position": {
				const position = scaleCoord(await computer.getCursorPosition(), display);
				return textResult(`${position.x},${position.y}`);
			}
			case "key": {
				const combo = parseKeyCombo(input.text ?? input.key);
				await computer.key(combo.key, combo.modifiers.length === 0 ? undefined : { modifiers: combo.modifiers });
				return okResult(input.action);
			}
			case "type":
				await computer.type(parseText(input.text, "type"));
				return okResult(input.action);
			case "scroll":
				await computer.scroll(parseScroll(input.scroll_direction, input.scroll_amount));
				return okResult(input.action);
			case "wait":
				await sleep(parseWaitDurationMilliseconds(input.duration));
				return textResult("wait complete");
			case "left_mouse_down":
			case "left_mouse_up":
			case "hold_key":
				throwUnsupportedAction(input.action);
		}
	} catch (error) {
		if (error instanceof ComputerUseError) {
			throw error;
		}
		throw new ComputerUseError("execution_failed", errorMessage(error), { cause: error });
	}
}

function textResult(text: string): ComputerUseResult {
	return { content: [{ type: "text", text }], details: undefined };
}

function okResult(action: string): ComputerUseResult {
	return textResult(JSON.stringify({ ok: true, action }));
}

function scaleCoord(point: Point, display: DisplayConfig): Point {
	return {
		x: Math.round(point.x * (display.modelWidth / display.logicalWidth)),
		y: Math.round(point.y * (display.modelHeight / display.logicalHeight)),
	};
}

function parseCoordinate(coordinate: readonly number[] | undefined, action: string): Point {
	if (coordinate === undefined || coordinate.length !== 2) {
		throw new ComputerUseError("invalid_arguments", `${action} requires coordinate [x, y]`);
	}
	const x = coordinate[0];
	const y = coordinate[1];
	if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new ComputerUseError("invalid_arguments", `${action} requires finite coordinate [x, y]`);
	}
	return { x, y };
}

function parseText(text: string | undefined, action: string): string {
	if (text === undefined || text.length === 0) {
		throw new ComputerUseError("invalid_arguments", `${action} requires text`);
	}
	return text;
}

function parseKeyCombo(text: string | undefined): { readonly key: string; readonly modifiers: KeyModifier[] } {
	const parts = parseText(text, "key")
		.split("+")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	const key = parts.at(-1);
	if (key === undefined) {
		throw new ComputerUseError("invalid_arguments", "key requires a non-empty key combo");
	}
	return { key, modifiers: parts.slice(0, -1).map(parseModifier) };
}

function parseModifier(modifier: string): KeyModifier {
	switch (modifier) {
		case "cmd":
		case "command":
		case "alt":
		case "option":
		case "ctrl":
		case "control":
		case "shift":
			return modifier;
		default:
			throw new ComputerUseError("invalid_arguments", `unsupported key modifier: ${modifier}`);
	}
}

function parseScroll(
	direction: ScrollDirection | undefined,
	amount: number | undefined,
): { readonly direction: ScrollDirection; readonly amount: number } {
	if (direction === undefined) {
		throw new ComputerUseError("invalid_arguments", "scroll requires scroll_direction");
	}
	if (amount === undefined || !Number.isFinite(amount) || amount <= 0) {
		throw new ComputerUseError("invalid_arguments", "scroll requires positive scroll_amount");
	}
	return { direction, amount };
}

function parseWaitDurationMilliseconds(duration: number | undefined): number {
	if (duration === undefined || !Number.isFinite(duration)) {
		throw new ComputerUseError("invalid_arguments", "wait requires finite duration");
	}
	return Math.min(MAX_WAIT_SECONDS, Math.max(0, duration)) * 1000;
}

async function tripleClick(computer: ComputerActionDriver, position: Point): Promise<void> {
	await computer.click(position);
	await sleep(TRIPLE_CLICK_GAP_MILLISECONDS);
	await computer.click(position);
	await sleep(TRIPLE_CLICK_GAP_MILLISECONDS);
	await computer.click(position);
}

function throwUnsupportedAction(action: "left_mouse_down" | "left_mouse_up" | "hold_key"): never {
	throw new ComputerUseError("unsupported_action", "Use click or drag tools for fine-grained mouse phases", {
		action,
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
