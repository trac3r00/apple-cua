import type { AgentToolResult } from "../pi/index.js";

export type ComputerUseResult = AgentToolResult<undefined>;

export interface Point {
	readonly x: number;
	readonly y: number;
}

export type MouseButton = "left" | "right" | "middle";

export interface ClickOptions {
	readonly button: MouseButton;
	readonly count: number;
	/** Held for the whole click: command, option, control or shift (aliases are resolved by the server). */
	readonly modifiers: readonly string[];
}

/** A key or chord such as "cmd+shift+t", optionally held for a number of seconds. */
export type KeyEntry = string | { readonly key: string; readonly hold_seconds: number };

/**
 * What the native computer-use shapes can ask for, in model coordinates: pixels of the latest screenshot of the
 * targeted window. The implementation turns each request into guarded apple-cua-mcp calls.
 */
export interface NativeComputer {
	screenshot(): Promise<ComputerUseResult>;
	click(point: Point, options: ClickOptions): Promise<ComputerUseResult>;
	drag(from: Point, to: Point): Promise<ComputerUseResult>;
	typeText(text: string): Promise<ComputerUseResult>;
	pressKeys(keys: readonly KeyEntry[]): Promise<ComputerUseResult>;
	wait(milliseconds: number): Promise<void>;
}

type ComputerUseErrorKind = "unsupported_action" | "invalid_arguments" | "needs_observation" | "execution_failed";

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

/** Reasons a native action has no faithful apple-cua-mcp equivalent; each is raised as an error, never faked. */
export const MCP_GAPS = {
	scroll:
		"apple-cua-mcp scrolls an observed scroll area by whole pages through accessibility (the scroll tool, with element_index and pages), not the wheel at a screen point. Call scroll with the element_index of the scroll area from get_app_state.",
	pointerMove:
		"apple-cua-mcp never moves the person's pointer (input goes to the target window) and has no hover-only action. Click where you mean to act, or use click_target with hover_first.",
	cursorPosition: "apple-cua-mcp does not report the pointer position.",
	mouseButtonPhase:
		"apple-cua-mcp has no separate button press or release. Use left_click, or left_click_drag for a drag.",
	navigationButton: "apple-cua-mcp clicks only the left, right and middle buttons.",
	dragPath:
		"apple-cua-mcp drags in a straight line between two points. Send a path with exactly a start and an end point.",
} as const;

export function unsupportedAction(action: string, reason: string): ComputerUseError {
	return new ComputerUseError("unsupported_action", `computer ${action} has no apple-cua-mcp equivalent: ${reason}`, {
		action,
	});
}

export function textResult(text: string): ComputerUseResult {
	return { content: [{ type: "text", text }], details: undefined };
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
