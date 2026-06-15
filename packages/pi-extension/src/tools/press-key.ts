import {
	type ComputerInterface,
	type KeySequenceEntry,
	type KeySequenceOptions,
	pressKeySequence,
	resolveAppPid,
	withTargetedApp,
} from "@macos-cua/core";
import { type Static, Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { actionCompleteResult } from "./result.js";

const KeyEntryParams = Type.Union([
	Type.String({ description: "Key or key combination to press." }),
	Type.Object(
		{
			key: Type.String({ description: "Key or key combination to press." }),
			hold_seconds: Type.Optional(
				Type.Number({ description: "Seconds to hold this key before releasing it.", minimum: 0 }),
			),
		},
		{ additionalProperties: false },
	),
]);

export const PressKeysParams = Type.Object(
	{
		app: Type.String({ description: "App name or bundle identifier." }),
		keys: Type.Array(KeyEntryParams, { minItems: 1, description: "Keys or key combinations to press in order." }),
		hold_seconds: Type.Optional(
			Type.Number({ description: "Default seconds to hold each key before releasing it.", minimum: 0 }),
		),
		interval_seconds: Type.Optional(
			Type.Number({ description: "Seconds to wait after each key before the next one.", minimum: 0 }),
		),
	},
	{ additionalProperties: false },
);

export type PressKeysInput = Static<typeof PressKeysParams>;

export function createPressKeysTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "press_keys",
		label: "Computer Use: press keys",
		description: "Press keys or key-combinations in order, optionally holding each key and waiting between keys.",
		parameters: PressKeysParams,
		async execute(_toolCallId, params) {
			const targetPid = await resolveAppPid(computer, params.app);
			await withTargetedApp(computer, targetPid, async () => {
				await pressKeySequence(computer, normalizeKeys(params.keys), keySequenceOptions(params));
			});
			return actionCompleteResult();
		},
	});
}

function normalizeKeys(keys: PressKeysInput["keys"]): readonly KeySequenceEntry[] {
	return keys.map((entry) =>
		typeof entry === "string" ? { key: entry } : keySequenceEntry(entry.key, entry.hold_seconds),
	);
}

function keySequenceEntry(key: string, holdSeconds: number | undefined): KeySequenceEntry {
	if (holdSeconds === undefined) {
		return { key };
	}
	return { key, holdSeconds };
}

function keySequenceOptions(params: PressKeysInput): KeySequenceOptions | undefined {
	const holdSeconds = params.hold_seconds;
	const intervalSeconds = params.interval_seconds;
	if (holdSeconds !== undefined && intervalSeconds !== undefined) {
		return { holdSeconds, intervalSeconds };
	}
	if (holdSeconds !== undefined) {
		return { holdSeconds };
	}
	if (intervalSeconds !== undefined) {
		return { intervalSeconds };
	}
	return undefined;
}
