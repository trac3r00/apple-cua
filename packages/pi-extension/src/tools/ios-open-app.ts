import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

const IosOpenAppParams = Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false });
type IosOpenAppInput = Static<typeof IosOpenAppParams>;
export function createIosOpenAppTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_open_app",
		"iPhone: open app",
		"Open an app in iPhone Mirroring. Requires a current ios_observe first.",
		IosOpenAppParams,
		keys,
		async (phone, params: IosOpenAppInput) => {
			await phone.openApp(params.name);
			return undefined;
		},
	);
}
