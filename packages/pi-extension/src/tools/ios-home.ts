import { Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

const IosHomeParams = Type.Object({}, { additionalProperties: false });
export function createIosHomeTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_home",
		"iPhone: home",
		"Go to the iPhone Home Screen. Requires a current ios_observe first.",
		IosHomeParams,
		keys,
		async (phone) => {
			await phone.home();
			return undefined;
		},
	);
}
