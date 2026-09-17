import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phonePoint, phoneTool } from "./ios-shared.js";

export const IosTapParams = Type.Object(
	{ x: Type.Number(), y: Type.Number(), long_press_ms: Type.Optional(Type.Number({ minimum: 0 })) },
	{ additionalProperties: false },
);
export type IosTapInput = Static<typeof IosTapParams>;
export function createIosTapTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_tap",
		"iPhone: tap",
		"Tap the observed iPhone screen at x,y. Requires a current ios_observe first.",
		IosTapParams,
		keys,
		async (phone, params: IosTapInput) => {
			const point = phonePoint(params);
			if (params.long_press_ms === undefined) await phone.tap(point.x, point.y);
			else await phone.longPress(point.x, point.y, params.long_press_ms);
			return point;
		},
	);
}
