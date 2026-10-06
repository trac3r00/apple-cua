import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

const IosPressKeysParams = Type.Object({ combo: Type.String({ minLength: 1 }) }, { additionalProperties: false });
type IosPressKeysInput = Static<typeof IosPressKeysParams>;
export function createIosPressKeysTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_press_keys",
		"iPhone: press keys",
		"Press an iPhone Mirroring key combination. Requires a current ios_observe first.",
		IosPressKeysParams,
		keys,
		async (phone, params: IosPressKeysInput) => {
			await phone.pressKeys(params.combo);
			return undefined;
		},
	);
}
