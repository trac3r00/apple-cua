import { IPhoneMirroring, findTexts } from "@apple-cua/core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

export const IosTapTextParams = Type.Object(
	{ query: Type.String(), index: Type.Optional(Type.Integer({ minimum: 0 })), exact: Type.Optional(Type.Boolean()) },
	{ additionalProperties: false },
);
export type IosTapTextInput = Static<typeof IosTapTextParams>;
export function createIosTapTextTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_tap_text",
		"iPhone: tap text",
		"Tap visible text on iPhone Mirroring. Requires a current ios_observe first; failure reports the text that is visible.",
		IosTapTextParams,
		keys,
		async (_phone, params: IosTapTextInput) => {
			const phone = new IPhoneMirroring();
			const observation = await phone.observe();
			const matches = findTexts(observation.texts, params.query, params.exact ?? false);
			const hit = matches[params.index ?? 0];
			if (hit === undefined) {
				throw new Error(
					`no visible text matches ${JSON.stringify(params.query)}; saw: ${JSON.stringify(observation.texts.slice(0, 30).map((text) => text.text))}`,
				);
			}
			const centre = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
			await phone.tap(centre.x, centre.y);
			return { text: hit.text, centre };
		},
	);
}
