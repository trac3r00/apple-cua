import type { ComputerInterface } from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

const ModifierParam = Type.Union([
	Type.Literal("command"),
	Type.Literal("option"),
	Type.Literal("control"),
	Type.Literal("shift"),
	Type.Literal("cmd"),
	Type.Literal("alt"),
	Type.Literal("ctrl"),
]);

export const KeyParams = Type.Object(
	{
		key: Type.String({ description: "Key to press, for example 'a', 'Enter', 'Escape', or 'Tab'." }),
		modifiers: Type.Optional(Type.Array(ModifierParam, { description: "Optional keyboard modifiers." })),
	},
	{ additionalProperties: false },
);

export type KeyInput = Static<typeof KeyParams>;

type MacOSModifier = "command" | "option" | "control" | "shift";
type ModifierInput = MacOSModifier | "cmd" | "alt" | "ctrl";

function normalizeModifier(modifier: ModifierInput): MacOSModifier {
	switch (modifier) {
		case "cmd":
			return "command";
		case "alt":
			return "option";
		case "ctrl":
			return "control";
		case "command":
		case "option":
		case "control":
		case "shift":
			return modifier;
	}
}

export function createKeyTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "macos_cua_key",
		label: "macOS CUA: keypress",
		description: "Press a key, optionally with keyboard modifiers, in the active macOS application.",
		parameters: KeyParams,
		async execute(_toolCallId, params) {
			const modifiers = params.modifiers?.map((modifier) => normalizeModifier(modifier));
			await computer.key(params.key, modifiers === undefined ? undefined : { modifiers });
			const suffix = modifiers === undefined || modifiers.length === 0 ? "" : ` with ${modifiers.join("+")}`;
			return textResult(`Pressed key: ${params.key}${suffix}.`);
		},
	});
}
