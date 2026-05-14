import type { ComputerInterface, Point } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type DisplayConfig, resizeScreenshotPng, unscaleCoord } from "./computer-use/coords.js";
import type { AgentToolResult } from "./pi/index.js";

export const ANTHROPIC_COMPUTER_USE_BETA = "computer-use-2025-01-24";
export const ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE = "computer_20250124";
export const ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME = "computer";

type ToolDefinition = Record<string, unknown>;
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

const coordinateSchema = Type.Array(Type.Number(), { minItems: 2, maxItems: 2 });

export const anthropicComputerToolSchema = Type.Object(
	{
		action: Type.Union([
			Type.Literal("screenshot"),
			Type.Literal("key"),
			Type.Literal("type"),
			Type.Literal("mouse_move"),
			Type.Literal("left_click"),
			Type.Literal("right_click"),
			Type.Literal("middle_click"),
			Type.Literal("double_click"),
			Type.Literal("triple_click"),
			Type.Literal("left_click_drag"),
			Type.Literal("cursor_position"),
			Type.Literal("left_mouse_down"),
			Type.Literal("left_mouse_up"),
			Type.Literal("scroll"),
			Type.Literal("hold_key"),
			Type.Literal("wait"),
		]),
		coordinate: Type.Optional(coordinateSchema),
		start_coordinate: Type.Optional(coordinateSchema),
		text: Type.Optional(Type.String()),
		key: Type.Optional(Type.String()),
		scroll_direction: Type.Optional(
			Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]),
		),
		scroll_amount: Type.Optional(Type.Number()),
		duration: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

export const computerToolSchema = anthropicComputerToolSchema;
export type ComputerToolInput = Static<typeof anthropicComputerToolSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isComputerToolType(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("computer_");
}

export function sanitizeTools(tools: readonly unknown[]): ToolDefinition[] {
	const sanitizedTools: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}
		const shouldStripFunctionVariant =
			tool["name"] === ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME && !isComputerToolType(tool["type"]);
		if (!shouldStripFunctionVariant) {
			sanitizedTools.push(tool);
		}
	}
	return sanitizedTools;
}

export function mergeBetaHeader(existing: unknown): string {
	const existingParts =
		typeof existing === "string"
			? existing
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean)
			: [];
	if (existingParts.includes(ANTHROPIC_COMPUTER_USE_BETA)) {
		return existingParts.join(",");
	}
	return [...existingParts, ANTHROPIC_COMPUTER_USE_BETA].join(",");
}

export function addAnthropicComputerUseToPayload(
	api: string | undefined,
	payload: unknown,
	display: DisplayConfig,
): unknown {
	if (api !== "anthropic-messages" || !isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload["tools"]) ? payload["tools"] : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeComputer = sanitizedTools.some((tool) => isComputerToolType(tool["type"]));
	if (!hasNativeComputer) {
		sanitizedTools.push({
			type: ANTHROPIC_NATIVE_COMPUTER_TOOL_TYPE,
			name: ANTHROPIC_NATIVE_COMPUTER_TOOL_NAME,
			display_width_px: display.modelWidth,
			display_height_px: display.modelHeight,
		});
	}

	const extraBody = payload["extra_body"];
	const existingBetas = isRecord(extraBody) ? extraBody["betas"] : undefined;
	const mergedBetas = Array.isArray(existingBetas)
		? existingBetas.includes(ANTHROPIC_COMPUTER_USE_BETA)
			? existingBetas
			: [...existingBetas, ANTHROPIC_COMPUTER_USE_BETA]
		: [ANTHROPIC_COMPUTER_USE_BETA];
	const headers = payload["headers"];
	const headerRecord = isRecord(headers) ? headers : {};

	return {
		...payload,
		tools: sanitizedTools,
		headers: { ...headerRecord, "anthropic-beta": mergeBetaHeader(headerRecord["anthropic-beta"]) },
		extra_body: { ...(isRecord(extraBody) ? extraBody : {}), betas: mergedBetas },
	};
}

export function buildComputerUseSection(width: number, height: number): string {
	return `## Computer Use\nNative \`computer\` tool available (${width}x${height}); prefer it for GUI. \`macos_cua_*\` tools remain for per-PID background delivery.\n`;
}

export async function executeNativeComputerAction(
	input: ComputerToolInput,
	computer: ComputerActionDriver,
	display: DisplayConfig,
): Promise<ComputerUseResult> {
	try {
		switch (input.action) {
			case "screenshot":
				return await screenshotResult(computer, display);
			case "mouse_move":
				await computer.move(unscaleCoord(parseCoordinate(input.coordinate, "mouse_move"), display));
				return await screenshotResult(computer, display);
			case "left_click":
				await computer.click(unscaleCoord(parseCoordinate(input.coordinate, "left_click"), display));
				return await screenshotResult(computer, display);
			case "right_click":
				await computer.rightClick(unscaleCoord(parseCoordinate(input.coordinate, "right_click"), display));
				return await screenshotResult(computer, display);
			case "middle_click":
				await computer.middleClick(unscaleCoord(parseCoordinate(input.coordinate, "middle_click"), display));
				return await screenshotResult(computer, display);
			case "double_click":
				await computer.doubleClick(unscaleCoord(parseCoordinate(input.coordinate, "double_click"), display));
				return await screenshotResult(computer, display);
			case "triple_click":
				await tripleClick(computer, unscaleCoord(parseCoordinate(input.coordinate, "triple_click"), display));
				return await screenshotResult(computer, display);
			case "left_click_drag":
				await computer.drag({
					from: unscaleCoord(parseCoordinate(input.start_coordinate, "left_click_drag.start_coordinate"), display),
					to: unscaleCoord(parseCoordinate(input.coordinate, "left_click_drag.coordinate"), display),
					duration: DEFAULT_DRAG_DURATION_MILLISECONDS,
				});
				return await screenshotResult(computer, display);
			case "cursor_position": {
				const position = scaleCoord(await computer.getCursorPosition(), display);
				return textResult(`${position.x},${position.y}`);
			}
			case "key": {
				const combo = parseKeyCombo(input.text ?? input.key);
				await computer.key(combo.key, combo.modifiers.length === 0 ? undefined : { modifiers: combo.modifiers });
				return await screenshotResult(computer, display);
			}
			case "type":
				await computer.type(parseText(input.text, "type"));
				return await screenshotResult(computer, display);
			case "scroll":
				await computer.scroll(parseScroll(input.scroll_direction, input.scroll_amount));
				return await screenshotResult(computer, display);
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

function imageResult(pngBase64: string): ComputerUseResult {
	return { content: [{ type: "image", data: pngBase64, mimeType: "image/png" }], details: undefined };
}

function textResult(text: string): ComputerUseResult {
	return { content: [{ type: "text", text }], details: undefined };
}

async function screenshotResult(computer: ComputerActionDriver, display: DisplayConfig): Promise<ComputerUseResult> {
	const screenshot = await computer.screenshot();
	const resized = await resizeScreenshotPng(screenshot.data, display.modelWidth, display.modelHeight);
	return imageResult(resized.toString("base64"));
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
	throw new ComputerUseError("unsupported_action", "Use macos_cua_* tools for fine-grained mouse phases", { action });
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
