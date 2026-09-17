import { IPhoneMirroring } from "@apple-cua/core";
import { type Static, Type } from "typebox";
import { type ToolDefinition, defineTool } from "../pi/index.js";
import { PhoneObservationKeys } from "./ios-shared.js";
import { textResult } from "./result.js";

export const IosObserveParams = Type.Object(
	{ minimum_confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })) },
	{ additionalProperties: false },
);
export type IosObserveInput = Static<typeof IosObserveParams>;

export function createIosObserveTool(keys = new PhoneObservationKeys()): ToolDefinition {
	return defineTool({
		name: "ios_observe",
		label: "iPhone: observe",
		description:
			"Observe iPhone Mirroring. Call this before every iOS mutation; returned text boxes have tap-ready centre coordinates.",
		parameters: IosObserveParams,
		async execute(_toolCallId, params) {
			const phone = new IPhoneMirroring(
				params.minimum_confidence === undefined ? {} : { minimumConfidence: params.minimum_confidence },
			);
			const observation = await phone.observe();
			keys.record(observation.window.id);
			const result = {
				...observation,
				texts: observation.texts.map((text) => ({
					...text,
					centre: { x: text.x + text.width / 2, y: text.y + text.height / 2 },
				})),
			};
			return textResult(JSON.stringify(result, null, 2), result);
		},
	});
}
