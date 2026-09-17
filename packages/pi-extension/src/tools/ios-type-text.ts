import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

export const IosTypeTextParams = Type.Object(
	{ text: Type.String(), mode: Type.Optional(Type.Union([Type.Literal("paste"), Type.Literal("keystrokes")])) },
	{ additionalProperties: false },
);
export type IosTypeTextInput = Static<typeof IosTypeTextParams>;
export function createIosTypeTextTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_type_text",
		"iPhone: type text",
		"Type into the focused iPhone field. Requires a current ios_observe first.",
		IosTypeTextParams,
		keys,
		async (phone, params: IosTypeTextInput) => {
			await phone.typeText(params.text, params.mode === undefined ? {} : { mode: params.mode });
			return undefined;
		},
	);
}
